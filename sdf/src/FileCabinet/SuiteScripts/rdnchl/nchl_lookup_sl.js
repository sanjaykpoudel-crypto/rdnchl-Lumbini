/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
// JSON endpoint for client scripts (rdmoduleclient.js): NCHL lists and the account check run here, so the
// NCHL credentials in npiconfig.js never reach the browser
define(['./rdmodule'], function (rdmodu) {
    const ACTIONS = {
        banks: params => rdmodu.getbanklist({type: params.type === 'IPS' ? 'IPS' : 'CIPS'}),
        branches: params => rdmodu.getbankbranchlist({bankId: params.bankId}),
        billers: params => rdmodu.getbillertypes(params.type || 'ALL') || [],
        /**
         * Account check (/api/validatebankaccount); NCHL also returns the account's branch
         */
        validate: params => {
            const result = rdmodu.verifyaccount({bankId: params.bankId, accountNumber: params.accountNumber, accountName: params.accountName})
            // NCHL's samples spell it matchPercentate, its field table matchPercentage
            const match = result.matchPercentate !== undefined ? result.matchPercentate : result.matchPercentage
            const branch = result.branchId
                ? rdmodu.getbankbranchlist({bankId: params.bankId}).find(b => String(b.branchId) === String(result.branchId))
                : null
            return {
                verified: match === 100,
                matchPercentage: match,
                responseCode: result.responseCode,
                responseMessage: result.responseMessage,
                accountName: result.accountName,
                branchId: result.branchId,
                branchName: branch ? branch.branchName : ''
            }
        }
    }

    return {
        onRequest: context => {
            // account details come in a POST body so they are not written to URLs and logs
            let params = context.request.parameters
            if (context.request.method === 'POST' && context.request.body) {
                params = Object.assign({}, params, JSON.parse(context.request.body))
            }
            let body
            try {
                if (!ACTIONS.hasOwnProperty(params.action)) {
                    throw new Error(`Unknown NCHL lookup: ${params.action}`)
                }
                body = {ok: true, data: ACTIONS[params.action](params)}
            } catch (e) {
                log.error('NCHL_LOOKUP_ERROR', {action: params.action, error: e.message})
                body = {ok: false, message: e.message}
            }
            context.response.setHeader({name: 'Content-Type', value: 'application/json'})
            context.response.write(JSON.stringify(body))
        }
    }
})
