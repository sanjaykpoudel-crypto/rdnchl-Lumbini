using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace NchlRelay;

/// <summary>Forwards every request received on ListenPort to TargetUrl (or a PathTargets host) and streams the answer back.</summary>
public sealed class RelayHost
{
    static readonly HashSet<string> HopByHopHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Connection", "Keep-Alive", "Proxy-Connection", "TE", "Trailer", "Transfer-Encoding", "Upgrade", "Host"
    };

    WebApplication? app;
    HttpClient? client;

    /// <summary>While paused, requests are answered with 503 and nothing is sent to NCHL.</summary>
    public volatile bool Paused;

    public async Task StartAsync()
    {
        var config = RelayConfig.Load();
        var targetBase = config.TargetUrl.TrimEnd('/');
        if (!Uri.TryCreate(targetBase, UriKind.Absolute, out _) || targetBase.Contains("CHANGE-ME"))
        {
            throw new InvalidOperationException($"Set TargetUrl in {RelayConfig.ConfigPath} to the NCHL address first.");
        }

        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            AutomaticDecompression = DecompressionMethods.None
        };
        if (config.IgnoreTargetCertificateErrors)
        {
            handler.SslOptions.RemoteCertificateValidationCallback = (_, _, _, _) => true;
        }
        client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(config.TimeoutSeconds) };
        var allowedIps = new HashSet<string>(config.AllowedClientIps ?? []);
        var pathTargets = new Dictionary<string, string>();
        foreach (var (prefix, target) in config.PathTargets ?? [])
        {
            var cleanPrefix = "/" + prefix.Trim('/');
            var cleanTarget = target.TrimEnd('/');
            if (cleanPrefix == "/" || !Uri.TryCreate(cleanTarget, UriKind.Absolute, out _))
            {
                throw new InvalidOperationException($"PathTargets entry \"{prefix}\": \"{target}\" in {RelayConfig.ConfigPath} is not a path prefix and URL.");
            }
            pathTargets[cleanPrefix] = cleanTarget;
        }

        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(kestrel =>
        {
            kestrel.ListenAnyIP(config.ListenPort);
            kestrel.Limits.MaxRequestBodySize = 10 * 1024 * 1024;
        });
        app = builder.Build();
        app.Run(context => ForwardAsync(context, targetBase, pathTargets, allowedIps));
        await app.StartAsync();
        Log.Write($"STARTED port {config.ListenPort} -> {targetBase}" +
                  string.Concat(pathTargets.Select(route => $", {route.Key} -> {route.Value}")) +
                  (allowedIps.Count > 0 ? $" (allowed IPs: {string.Join(", ", allowedIps)})" : " (any client IP)"));
    }

    public async Task StopAsync()
    {
        if (app != null)
        {
            await app.StopAsync();
            await app.DisposeAsync();
            app = null;
        }
        client?.Dispose();
        client = null;
        Log.Write("STOPPED");
    }

    async Task ForwardAsync(HttpContext context, string defaultTarget, Dictionary<string, string> pathTargets, HashSet<string> allowedIps)
    {
        var started = DateTime.UtcNow;
        var request = context.Request;
        var remote = context.Connection.RemoteIpAddress;
        // dual-stack sockets report IPv4 clients as ::ffff:a.b.c.d; only those are converted
        var clientIp = remote == null ? "?" : (remote.IsIPv4MappedToIPv6 ? remote.MapToIPv4() : remote).ToString();
        int status;

        if (allowedIps.Count > 0 && !allowedIps.Contains(clientIp))
        {
            status = StatusCodes.Status403Forbidden;
            context.Response.StatusCode = status;
        }
        else if (Paused)
        {
            status = StatusCodes.Status503ServiceUnavailable;
            context.Response.StatusCode = status;
            await context.Response.WriteAsync("NCHL relay is paused");
        }
        else
        {
            try
            {
                var targetBase = defaultTarget;
                var path = request.Path;
                foreach (var (prefix, target) in pathTargets)
                {
                    if (request.Path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase, out var rest))
                    {
                        targetBase = target;
                        path = rest;
                        break;
                    }
                }
                using var outgoing = new HttpRequestMessage(new HttpMethod(request.Method), targetBase + path + request.QueryString);
                if (request.ContentLength > 0 || request.Headers.ContainsKey("Transfer-Encoding"))
                {
                    var body = new MemoryStream();
                    await request.Body.CopyToAsync(body, context.RequestAborted);
                    body.Position = 0;
                    outgoing.Content = new StreamContent(body);
                }
                foreach (var header in request.Headers)
                {
                    if (HopByHopHeaders.Contains(header.Key)) continue;
                    if (!outgoing.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()))
                    {
                        outgoing.Content?.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
                    }
                }

                using var response = await client!.SendAsync(outgoing, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
                status = (int)response.StatusCode;
                context.Response.StatusCode = status;
                foreach (var header in response.Headers.Concat(response.Content.Headers))
                {
                    if (HopByHopHeaders.Contains(header.Key)) continue;
                    context.Response.Headers[header.Key] = header.Value.ToArray();
                }
                await response.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
            }
            catch (Exception e)
            {
                status = StatusCodes.Status502BadGateway;
                if (!context.Response.HasStarted)
                {
                    context.Response.StatusCode = status;
                    await context.Response.WriteAsync("NCHL relay could not reach NCHL: " + e.Message);
                }
                Log.Write($"ERROR {clientIp} {request.Method} {request.Path}: {e.GetType().Name}: {e.Message}");
            }
        }

        // path only: query strings and bodies can carry credentials or payment data
        Log.Write($"{clientIp} {request.Method} {request.Path} -> {status} ({(DateTime.UtcNow - started).TotalMilliseconds:0} ms)");
    }
}
