/**
 * @NApiVersion 2.1
 * @NScriptType restlet
 */
define(['./npihelper'], function (npi) {
    return {
        get: params => {
            try {
                const customer = npi.findcustomer(params);
                if (params.customer_code && params.dealer_code) {
                    //const dealer = npi.findDealer(params);
                    const transaction = npi.getinvoiceamount({
                        entityid: customer.customer_id,
                        //dealerid: dealer.dealer_id
                    });
                    return JSON.stringify({
                        customer: customer,
                        //dealer: dealer,
                        invoice: transaction
                    });
                } else if (!params.dealer_code && params.customer_code && !customer.hasOwnProperty('error_code')) {
                    const transaction = npi.getinvoiceamount({
                        entityid: customer.customer_id
                    });
                    return JSON.stringify({
                        customer: customer,
                        invoice: transaction
                    });
                } else {
                    return JSON.stringify(customer);
                }
            } catch (e) {
                return JSON.stringify(e);
            }
        },
        post: params => {
            log.debug({title: 'NPI_REQUEST', details: params});
            if(npi.findrecordbynchlno(params.tran_no)) {
                return JSON.stringify({
                    tran_no: params.tran_no,
                    record_exists: true,
                    summary: `Record with Transaction Number ${params.tran_no} already exist`
                })
            } else {
                const option = {
                    //subsidiary: params.subsidiary_id,
                    amount: params.amount_paid,
                    npi_tran_no: params.tran_no,
                    memo: params.tran_no + ', ' + params.tran_date
                }
                if (params.customer_code) {
                    const customerObj = npi.findcustomer(params);
                    option.entityid = customerObj.customer_id;
                } else {
                    option.entityid = params.customer_id;
                }

                if (params.dealer_code) {
                    const dealerObj = npi.findDealer(params);
                    option.dealer_id = dealerObj.dealer_id;
                } else if (params.dealer_id) {
                    option.dealer_id = params.dealer_id;
                }
                const savedRecordStatus = npi.savepayment(option);
                return JSON.stringify(savedRecordStatus);
            }
        }
    };
});
