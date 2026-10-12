/**
 * @NApiVersion 2.1
 */
// Government payments through NCHL billers: lodge the bill (NCHL and the biller check it), then confirm (pay).
// One journal pays one bill. App codes and fields come from NCHL UAT (/billers/v2/categories and
// /billers/v2/appjourneydetails); check the app codes in production before go-live.
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
        }
    }
})
