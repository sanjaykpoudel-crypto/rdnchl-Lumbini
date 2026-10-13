/**
 * @NApiVersion 2.1
 */
// Government payments through NCHL billers. One journal pays one bill. API mode: the user types the bill reference
// (fields below), NetSuite lodges it, then confirms (pays) it. Iframe mode (once IFRAME is set up): the user finds and
// confirms the bill in NCHL's page, which offers every biller, but only the billers below can be paid from NetSuite.
// App codes and fields come from NCHL UAT (/billers/v2/categories and /billers/v2/appjourneydetails); check them in
// production before go-live.
define([], function () {
    const BILLERS = {
        IRD: {
            label: 'IRD (TDS, VAT, salary tax)',
            appId: 'GON-6-RBB-FDRL',
            // IRD takes the amount from the payer; SSF and CIT return it from the bill
            amountFromBiller: false,
            fields: [{id: 'refId', label: 'Voucher No (RMIS EBP Code)', maxLength: 35}]
        },
        SSF: {
            label: 'SSF',
            appId: 'SSF-101-NBL-1',
            // the NPI Billers iframe offers SSF under a different app code than the billers API
            iframeAppIds: ['SSF-101-APP-1'],
            amountFromBiller: true,
            fields: [
                {id: 'refId', label: 'Submission Number', maxLength: 14},
                {id: 'freeText1', label: 'Employer Number', maxLength: 100}
            ]
        },
        CIT: {
            label: 'CIT (employee contribution)',
            appId: 'CIT-151-APP-8',
            amountFromBiller: true,
            fields: [
                {id: 'refId', label: 'Submission Number', maxLength: 35},
                {id: 'freeCode2', label: 'Office Code', maxLength: 100}
            ]
        },
        // UAT only, to test the iframe payment end to end (NTC's minimum top-up is Rs 10). Remove before go-live,
        // with its list value val_lc_gov_test.
        TEST: {
            label: 'TEST NTC top-up (UAT only)',
            appId: 'MER-1544-APP-1',
            amountFromBiller: false,
            fields: [{id: 'refId', label: 'Mobile Number', maxLength: 10}]
        }
    }

    return {
        BILLERS: BILLERS,
        // NPI Billers iframe (spec v2), UAT values from NCHL. The key files are made from NCHL's certificates
        // (NPIBILLERSIGN.pfx: our signing key, PS256; NPIBILLERENC.cer: NCHL's encryption certificate, RSA-OAEP-256 +
        // A256GCM), kept in the git-ignored rdnchl-keys folder and uploaded by the SDF deploy; never commit them.
        // Production needs NCHL's production URL, participant code and certificates.
        IFRAME: {
            URL: 'https://uat.connectips.com/billers/billers',
            // messages are only accepted from this origin
            ORIGIN: 'https://uat.connectips.com',
            PARTICIPANT_CODE: 'LUMBINICERAMICS',
            // kid for the JWE and JWS headers: NCHL gave none, so the headers carry no kid
            NCHL_KEY_ID: '',
            OWN_KEY_ID: '',
            // our private key (PEM, from NPIBILLERSIGN.pfx) and NCHL's certificate (PEM, from NPIBILLERENC.cer), saved as
            // .txt so the File Cabinet keeps them as text; the certificate also checks the signature of NCHL's bill
            PRIVATE_KEY_FILE: '/SuiteScripts/rdnchl-keys/npibillersign_private_pem.txt',
            NCHL_PUBLIC_KEY_FILE: '/SuiteScripts/rdnchl-keys/npibillerenc_pem.txt'
        },
        // NPI connection for paying bills confirmed in the iframe (confirmbillerpay.do): NCHL's separate UAT login, not
        // npiconfig. The two passwords are in CREDENTIALS_FILE ({"PASSWORD": basic auth, "USERPASS": user}) in the
        // git-ignored rdnchl-keys folder. CERTIFICATE_ID is NCHL's NPI.pfx uploaded under Setup > Company > Certificates.
        NPI: {
            HOST: 'https://devnpi.connectips.com',
            USERNAME: 'lumbiniceramics',
            USERID: 'LUMBINICERAMICS@999',
            CERTIFICATE_ID: 'custcertificate_lc_npi_biller',
            CREDENTIALS_FILE: '/SuiteScripts/rdnchl-keys/npibiller_credentials_json.txt'
        },
        // Government revenue: the category purpose NCHL's biller documentation uses
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
         * @returns {string[]} what is missing before the iframe can be used; until then the API mode is used.
         * The key files are checked by npibillersjose.getsetupgaps.
         */
        getiframesetupgaps: function () {
            return this.IFRAME.PARTICIPANT_CODE ? [] : ['participant code']
        }
    }
})
