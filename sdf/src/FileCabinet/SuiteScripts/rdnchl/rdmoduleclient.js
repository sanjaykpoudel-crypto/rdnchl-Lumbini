/**
 * @NApiVersion 2.1
 */
// Client-side helpers. NCHL is called through the LC NCHL Lookup Suitelet (nchl_lookup_sl.js) so the NCHL
// credentials stay on the server.
define(['N/https', 'N/url', 'N/search'], function (https, url, search) {
    function lookupurl(action, params) {
        return window.location.origin + url.resolveScript({
            scriptId: 'customscript_lc_nchl_lookup',
            deploymentId: 'customdeploy_lc_nchl_lookup',
            params: Object.assign({action: action}, params || {})
        })
    }

    function readlookup(response) {
        const body = JSON.parse(response.body)
        if (!body.ok) {
            throw new Error(body.message)
        }
        return body.data
    }

    function getlist(action, params) {
        try {
            return readlookup(https.get({url: lookupurl(action, params)})) || []
        } catch (e) {
            console.error('NCHL_LOOKUP_' + action.toUpperCase(), e)
            return []
        }
    }

    return {
        /**
         * @param option
         * @param {string} option.type CIPS or IPS
         * @returns {{bankId: string, bankName: string}[]}
         */
        getbanklist: function (option) {
            return getlist('banks', {type: option.type})
        },
        /**
         * @param option
         * @param {string} option.bankId
         * @returns {{branchId: string, bankId: string, branchName: string}[]}
         */
        getbankbranchlist: function (option) {
            return getlist('branches', {bankId: option.bankId})
        },
        getbillers: function (type) {
            return getlist('billers', {type: type})
        },
        /**
         * Asks NCHL whether the account number and name match, without blocking the page (it can take seconds)
         * @param option
         * @param {string} option.bankId
         * @param {string} option.accountNumber
         * @param {string} option.accountName
         * @returns {Promise<{verified: boolean, matchPercentage: number, responseMessage: string, accountName: string,
         *     branchId: string, branchName: string}>}
         */
        verifyaccount: function (option) {
            return https.post.promise({
                url: lookupurl('validate'),
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({bankId: option.bankId, accountNumber: option.accountNumber, accountName: option.accountName})
            }).then(readlookup)
        },
        getentitybanks: function (entityid, type) {
            const selectOptions = [{value: '', text: ''}]
            search.create({
                type: 'customrecord_rd_nchl_bank_detail',
                filters: [
                    ['custrecord_nchl_bank_entity', 'anyof', entityid],
                    'AND',
                    ['custrecord_nchl_bank_type', 'is', type]
                ],
                columns: ['name']
            }).run().each(function (result) {
                selectOptions.push({
                    value: result.id,
                    text: result.getValue('name')
                })
                return true
            })
            return selectOptions
        }
    }
})
