define(['./npiconfig', 'N/http', 'N/currentRecord'], function (npiconf, http, currentRecord) {
    return {
        generatetoken: function (urlToRedirect) {
            const b64basic = btoa(npiconf.USERNAME + ':' + npiconf.PASSWORD)
            const reqHeaders = {
                "Authorization": 'Basic ' + b64basic,
                "Content-Type": "application/x-www-form-urlencoded"
            }
            const postBody = {
                "grant_type": "password",
                "username": npiconf.USERID,
                "password": npiconf.USERPASS
            }
            const response = http.request({
                method: http.Method.POST,
                url: npiconf.HOST + '/oauth/token',
                headers: reqHeaders,
                body: postBody
            })
            const responseBody = JSON.parse(response.body)
            window.location = urlToRedirect + '&token=' + responseBody.access_token
        }
    }
})