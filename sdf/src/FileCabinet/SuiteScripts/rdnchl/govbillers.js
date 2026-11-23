/**
 * @NApiVersion 2.1
 */
// Government payments through NCHL billers. One journal pays one bill. API mode: the user types the bill reference
// (fields below), NetSuite lodges it, then confirms (pays) it. Iframe mode (once IFRAME is set up): the user finds and
// confirms the bill in NCHL's page, which offers every biller, but only the billers below can be paid from NetSuite.
// App codes and fields come from NCHL UAT (/billers/v2/categories and /billers/v2/appjourneydetails); check them in
// production before go-live.
// The account picks the NCHL environment: the production account uses NCHL live, a sandbox uses NCHL UAT.
define(['N/runtime'], function (runtime) {
    // read when used: SuiteScript modules cannot be called while define runs
    const islive = () => runtime.envType === runtime.EnvType.PRODUCTION
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
        }
    }
    const UAT_BILLERS = {
        // UAT only, to test the iframe payment end to end with NCHL's test billers (NTC / Ncell top-up, internet, TV;
        // top-ups start at Rs 10): any biller confirmed in NCHL's page is accepted, the amount must still match.
        // Not offered in production, where its list value val_lc_gov_test is refused.
        TEST: {
            label: 'TEST top-up, internet, TV (UAT only)',
            appId: 'MER-1544-APP-1',
            anyIframeAppId: true,
            amountFromBiller: false,
            fields: [{id: 'refId', label: 'Mobile Number', maxLength: 10}]
        },
        // UAT only: the same test billers paid non-real-time (NRT), which NCHL otherwise uses only above NPR 20 lakh.
        // Not offered in production, where its list value val_lc_gov_test_nrt is refused.
        TESTNRT: {
            label: 'TESTNRT non-real-time top-up (UAT only)',
            appId: 'MER-1544-APP-1',
            anyIframeAppId: true,
            forceNrt: true,
            amountFromBiller: false,
            fields: [{id: 'refId', label: 'Mobile Number', maxLength: 10}]
        }
    }

    // NPI Billers iframe (spec v2). The key files are made from NCHL's certificates and kept in the git-ignored
    // rdnchl-keys folder, which the SDF deploy uploads; never commit them. Our signing key (PS256): NPIBILLERSIGN.pfx
    // in UAT, the company's LUMBINICERAMIC.pfx live. NCHL's encryption certificate (RSA-OAEP-256 + A256GCM), which also
    // checks the signature of NCHL's bill: NPIBILLERENC.cer in UAT and live. NCHL resent it as NEPALPAYBILLERS.cer on
    // 23 Nov 2026 (the one sent first got error 800). It shows as expired on 27 Sep 2026, but live still accepts it.
    const LIVE_IFRAME = {
        URL: 'https://billers.nepalpay.com.np/billers/billers',
        // messages are only accepted from this origin
        ORIGIN: 'https://billers.nepalpay.com.np',
        PARTICIPANT_CODE: 'lumbiniceramic',
        // kid for the JWE and JWS headers: NCHL gave none, so the headers carry no kid
        NCHL_KEY_ID: '',
        OWN_KEY_ID: '',
        // PEM saved as .txt so the File Cabinet keeps them as text
        PRIVATE_KEY_FILE: '/SuiteScripts/rdnchl-keys/lumbiniceramic_sign_private_pem.txt',
        NCHL_PUBLIC_KEY_FILE: '/SuiteScripts/rdnchl-keys/npibillerenc_pem.txt'
    }
    const UAT_IFRAME = {
        URL: 'https://uat.connectips.com/billers/billers',
        ORIGIN: 'https://uat.connectips.com',
        PARTICIPANT_CODE: 'LUMBINICERAMICS',
        NCHL_KEY_ID: '',
        OWN_KEY_ID: '',
        PRIVATE_KEY_FILE: '/SuiteScripts/rdnchl-keys/npibillersign_private_pem.txt',
        NCHL_PUBLIC_KEY_FILE: '/SuiteScripts/rdnchl-keys/npibillerenc_pem.txt'
    }
    // NPI connection for paying bills confirmed in the iframe (confirmbillerpay.do) and for bank statements.
    // Live: null, so the company's live NPI login (npiconfig) is used, as NCHL asked. UAT: NCHL's separate UAT
    // login; the two passwords are in CREDENTIALS_FILE ({"PASSWORD": basic auth, "USERPASS": user}) in the
    // git-ignored rdnchl-keys folder. CERTIFICATE_ID is NCHL's NPI.pfx uploaded under Setup > Company > Certificates.
    const UAT_NPI = {
        // direct from NetSuite (NCHL whitelists NetSuite's IP). Through the relay instead:
        // 'http://202.63.242.6:8181/devnpi' (relay.json PathTargets "/devnpi": "https://devnpi.connectips.com")
        HOST: 'https://devnpi.connectips.com',
        USERNAME: 'lumbiniceramics',
        USERID: 'LUMBINICERAMICS@999',
        CERTIFICATE_ID: 'custcertificate_lc_npi_biller',
        CREDENTIALS_FILE: '/SuiteScripts/rdnchl-keys/npibiller_credentials_json.txt'
    }

    return {
        get BILLERS() {
            return islive() ? BILLERS : Object.assign({}, BILLERS, UAT_BILLERS)
        },
        // NPI Billers iframe: live in production, UAT in a sandbox
        get IFRAME() {
            return islive() ? LIVE_IFRAME : UAT_IFRAME
        },
        // NPI login for bills confirmed in the iframe and for statements: null in production (npiconfig is used)
        get NPI() {
            return islive() ? null : UAT_NPI
        },
        // Government revenue: the category purpose NCHL's biller documentation uses
        PURPOSE: 'GREV',
        // credit statuses NCHL's confirm bill pay documentation counts as paid
        PAID_CREDIT_STATUSES: ['000', 'DEFER', '999', 'ACSC'],
        // final rejected credit (NCHL-IPS: GEN, SENT, ACTC, ACSP are on the way, ACSC accepted, RJCT rejected)
        REJECTED_CREDIT_STATUSES: ['RJCT'],
        /**
         * The journal's NCHL Government Payment list values are named "IRD ...", "SSF ...", "CIT ..."
         * @param {string} text the selected value's text
         * @returns {string|null} key of BILLERS
         */
        getbillerkey: function (text) {
            const key = String(text || '').trim().split(/\s/)[0].toUpperCase()
            return this.BILLERS.hasOwnProperty(key) ? key : null
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
