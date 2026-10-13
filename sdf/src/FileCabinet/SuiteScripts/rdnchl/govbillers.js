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

    return {
        BILLERS: BILLERS,
        // NPI Billers iframe (spec v2). PARTICIPANT_CODE, the key ids and both keys come from NCHL; the key files are
        // uploaded to the File Cabinet by hand and must never be committed. Production needs NCHL's production URL.
        IFRAME: {
            URL: 'https://uat.connectips.com/billers/billers',
            // messages are only accepted from this origin
            ORIGIN: 'https://uat.connectips.com',
            PARTICIPANT_CODE: 'lumbiniceramics',
            // kid of NCHL's NPI Billers public key (JWE header) and of our key (JWS header, if NCHL wants one)
            NCHL_KEY_ID: '',
            OWN_KEY_ID: '',
            // our NPI Billers private key (PEM, PKCS#8 or PKCS#1) and NCHL's NPI Billers public key or certificate (PEM)
            PRIVATE_KEY_FILE: '/SuiteScripts/rdnchl-keys/npibillers_private.pem',
            NCHL_PUBLIC_KEY_FILE: '/SuiteScripts/rdnchl-keys/npibillers_nchl_public.pem'
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
         * @returns {string[]} what is missing before the iframe can be used; until then the API mode is used
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
