/**
 * @NApiVersion 2.1
 */
// Government payments through the NCHL NPI Billers iframe: the user finds and confirms the bill inside NCHL's page,
// NetSuite adds the paying bank and confirms (pays) it. One journal pays one bill. The iframe offers every biller,
// but only the billers below can be paid from NetSuite. App codes come from NCHL UAT (/billers/v2/categories);
// check them in production before go-live.
define([], function () {
    const BILLERS = {
        IRD: {label: 'IRD (TDS, VAT, salary tax)', appId: 'GON-6-RBB-FDRL'},
        SSF: {label: 'SSF', appId: 'SSF-101-NBL-1'},
        CIT: {label: 'CIT (employee contribution)', appId: 'CIT-151-APP-8'}
    }

    return {
        BILLERS: BILLERS,
        // NPI Billers iframe (spec v2). PARTICIPANT_CODE, the key ids and both keys come from NCHL; the key files are
        // uploaded to the File Cabinet by hand and must never be committed. Production needs NCHL's production URL.
        IFRAME: {
            URL: 'https://uat.connectips.com/billers/billers',
            // messages are only accepted from this origin
            ORIGIN: 'https://uat.connectips.com',
            PARTICIPANT_CODE: '',
            // kid of NCHL's NPI Billers public key (JWE header) and of our key (JWS header, if NCHL wants one)
            NCHL_KEY_ID: '',
            OWN_KEY_ID: '',
            // our NPI Billers private key (PEM, PKCS#8 or PKCS#1) and NCHL's NPI Billers public key or certificate (PEM)
            PRIVATE_KEY_FILE: '/SuiteScripts/rdnchl-keys/npibillers_private.pem',
            NCHL_PUBLIC_KEY_FILE: '/SuiteScripts/rdnchl-keys/npibillers_nchl_public.pem'
        },
        // Government revenue: used when NCHL's bill does not carry a category purpose
        PURPOSE: 'GREV',
        // credit statuses NCHL's confirm bill pay documentation counts as paid
        PAID_CREDIT_STATUSES: ['000', 'DEFER', '999', 'ACSC'],
        /**
         * The journal's NCHL Government Payment list values are named "IRD ...", "SSF ...", "CIT ..."
         * @param {string} text the selected value's text
         * @returns {string|null} key of BILLERS
         */
        getbillerkey: function (text) {
            const key = String(text || '').trim().split(/\s/)[0].toUpperCase()
            return BILLERS.hasOwnProperty(key) ? key : null
        },
        /**
         * @returns {string[]} what is missing before the iframe can be used
         */
        getiframesetupgaps: function () {
            const gaps = []
            if (!this.IFRAME.PARTICIPANT_CODE) {
                gaps.push('participant code')
            }
            if (!this.IFRAME.NCHL_KEY_ID) {
                gaps.push('NCHL key id')
            }
            return gaps
        }
    }
})
