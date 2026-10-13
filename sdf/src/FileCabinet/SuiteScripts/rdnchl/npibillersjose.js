/**
 * @NApiVersion 2.1
 */
// JOSE for the NCHL NPI Billers iframe (spec v2, "Security"): what we send is signed with our private key (JWS PS256)
// and then encrypted for NCHL (JWE RSA-OAEP-256 + A256GCM); what NCHL sends (npiObject) is decrypted with our private
// key and its signature checked with NCHL's public key. NetSuite's N/crypto has none of these, so node-forge does it.
// The keys are PEM files in the File Cabinet (govbillers.IFRAME), never in the repo.
define(['N/file', 'N/crypto/random', './lib/forge', './govbillers'], function (file, cryptoRandom, forge, gov) {
    // forge's own random generator seeds itself from Math.random here: use NetSuite's secure random instead
    function randombytes(count) {
        const bytes = cryptoRandom.generateBytes({size: count})
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i])
        }
        return binary
    }

    forge.random.getBytesSync = randombytes
    forge.random.getBytes = (count, callback) => callback ? callback(null, randombytes(count)) : randombytes(count)

    function base64url(binary) {
        return forge.util.encode64(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }

    function frombase64url(text) {
        const base64 = String(text).replace(/-/g, '+').replace(/_/g, '/')
        return forge.util.decode64(base64 + '==='.slice((base64.length + 3) % 4))
    }

    function readpem(path, what) {
        if (!path) {
            throw new Error(`NPI Billers ${what} is not set up (govbillers.IFRAME)`)
        }
        try {
            return file.load({id: path}).getContents()
        } catch (e) {
            throw new Error(`NPI Billers ${what} not found in the File Cabinet at ${path}`)
        }
    }

    function privatekey() {
        return forge.pki.privateKeyFromPem(readpem(gov.IFRAME.PRIVATE_KEY_FILE, 'private key'))
    }

    // NCHL may hand over its key as a public key or as a certificate
    function nchlpublickey() {
        const pem = readpem(gov.IFRAME.NCHL_PUBLIC_KEY_FILE, 'NCHL public key')
        return /BEGIN CERTIFICATE/.test(pem) ? forge.pki.certificateFromPem(pem).publicKey : forge.pki.publicKeyFromPem(pem)
    }

    function sha256() {
        return forge.md.sha256.create()
    }

    function pss() {
        return forge.pss.create({md: sha256(), mgf: forge.mgf.mgf1.create(sha256()), saltLength: 32, prng: {getBytesSync: randombytes}})
    }

    function oaep() {
        return {md: sha256(), mgf1: {md: sha256()}}
    }

    function sign(payload) {
        const header = {alg: 'PS256'}
        if (gov.IFRAME.OWN_KEY_ID) {
            header.kid = gov.IFRAME.OWN_KEY_ID
        }
        const signingInput = base64url(forge.util.encodeUtf8(JSON.stringify(header))) + '.' +
            base64url(forge.util.encodeUtf8(JSON.stringify(payload)))
        const md = sha256()
        md.update(signingInput, 'utf8')
        return signingInput + '.' + base64url(privatekey().sign(md, pss()))
    }

    function encrypt(jws) {
        const header = {cty: 'JWT', enc: 'A256GCM', alg: 'RSA-OAEP-256'}
        if (gov.IFRAME.NCHL_KEY_ID) {
            header.kid = gov.IFRAME.NCHL_KEY_ID
        }
        const encodedHeader = base64url(JSON.stringify(header))
        const contentKey = randombytes(32)
        const iv = randombytes(12)
        const cipher = forge.cipher.createCipher('AES-GCM', contentKey)
        cipher.start({iv: iv, additionalData: encodedHeader, tagLength: 128})
        cipher.update(forge.util.createBuffer(forge.util.encodeUtf8(jws)))
        cipher.finish()
        return [
            encodedHeader,
            base64url(nchlpublickey().encrypt(contentKey, 'RSA-OAEP', oaep())),
            base64url(iv),
            base64url(cipher.output.getBytes()),
            base64url(cipher.mode.tag.getBytes())
        ].join('.')
    }

    function decrypt(jwe) {
        const parts = String(jwe).trim().split('.')
        if (parts.length !== 5) {
            throw new Error('NCHL data is not an encrypted token (JWE)')
        }
        const header = JSON.parse(frombase64url(parts[0]))
        if (header.alg !== 'RSA-OAEP-256' || header.enc !== 'A256GCM') {
            throw new Error(`Unexpected NCHL encryption ${header.alg} / ${header.enc}`)
        }
        const contentKey = privatekey().decrypt(frombase64url(parts[1]), 'RSA-OAEP', oaep())
        const decipher = forge.cipher.createDecipher('AES-GCM', contentKey)
        decipher.start({
            iv: frombase64url(parts[2]),
            additionalData: parts[0],
            tagLength: 128,
            tag: forge.util.createBuffer(frombase64url(parts[4]))
        })
        decipher.update(forge.util.createBuffer(frombase64url(parts[3])))
        if (!decipher.finish()) {
            throw new Error('NCHL data could not be decrypted (wrong key or changed data)')
        }
        return forge.util.decodeUtf8(decipher.output.getBytes())
    }

    // the spec signs with PS256 but says to verify with RS256, so both are accepted
    function verify(jws) {
        const parts = String(jws).trim().split('.')
        if (parts.length !== 3) {
            throw new Error('NCHL data is not a signed token (JWS)')
        }
        const header = JSON.parse(frombase64url(parts[0]))
        const md = sha256()
        md.update(parts[0] + '.' + parts[1], 'utf8')
        const signature = frombase64url(parts[2])
        let valid
        try {
            if (header.alg === 'PS256') {
                valid = nchlpublickey().verify(md.digest().getBytes(), signature, pss())
            } else if (header.alg === 'RS256') {
                valid = nchlpublickey().verify(md.digest().getBytes(), signature)
            } else {
                throw new Error(`Unexpected NCHL signature ${header.alg}`)
            }
        } catch (e) {
            if (/Unexpected/.test(e.message)) {
                throw e
            }
            valid = false
        }
        if (!valid) {
            throw new Error('NCHL signature is not valid: the data did not come from NCHL')
        }
        return JSON.parse(forge.util.decodeUtf8(frombase64url(parts[1])))
    }

    return {
        /**
         * Landing page token: payload signed by us, then encrypted for NCHL
         * @param {Object} payload {participant_code, session_id, channel}
         * @returns {string} compact JWE
         */
        maketoken: payload => encrypt(sign(payload)),
        /**
         * npiObject from the iframe's submit_form_payload message
         * @param {string} jwe compact JWE
         * @returns {Object} {cipsBatchDetail, cipsTransactionDetail, fieldLabelMapping}
         */
        opennpiobject: jwe => verify(decrypt(jwe)),
        uuid: () => cryptoRandom.generateUUID(),
        /**
         * @returns {string[]} what is missing before the iframe can be used: setup in govbillers and the key files
         */
        getsetupgaps: function () {
            const gaps = gov.getiframesetupgaps()
            ;[[gov.IFRAME.PRIVATE_KEY_FILE, 'our private key'], [gov.IFRAME.NCHL_PUBLIC_KEY_FILE, 'NCHL certificate']].forEach(([path, what]) => {
                try {
                    file.load({id: path})
                } catch (e) {
                    gaps.push(what)
                }
            })
            return gaps
        }
    }
})
