const functions = require('firebase-functions');
const nodemailer = require('nodemailer');
const request = require('request');
const stripHtml = require('string-strip-html');

// Environment variables configured for use with sending emails for forms.
// See https://firebase.google.com/docs/functions/config-env
const gmailEmail = functions.config().gmail.formsemail;
const gmailPassword = functions.config().gmail.formspassword;

// Configure the email transport using the default SMTP transport and a GMail account.
// For other types of transports such as Sendgrid see https://nodemailer.com/transports/
const mailTransport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: gmailEmail,
        pass: gmailPassword,
    },
});

// Process each form request that gets submitted.
exports.processRequest = functions.database.ref('/requests/{requestId}').onCreate((snapshot, context) => {
    // Document the request id for possible use in logging errors.
    const requestId = context.params.requestId;
    // Grab the request.
    const newRequest = snapshot.val();
    console.log(newRequest);
    const reqDetails = JSON.parse(newRequest.submission);
    const when = new Date(newRequest.timestamp);
    console.log(`details: ${JSON.stringify(reqDetails)}`);
    console.log(`when: ${when.toString()}`);
    console.log(`form: ${reqDetails.form_id}`);

    // @TODO Validation of required inputs should be client side only
    // @TODO Just thinking... submit click in the form should make sure all required fields have been populated at least!

    // Initialize email routing/content.
    let libraryOptions = {
        from: '',
        replyTo: '',
        to: '',
        subject: '',
        text: '',
        html: ''
    };
    let patronOptions = {
        from: '"UVA Library" <no-reply-library@Virginia.EDU>',
        replyTo: '"UVA Library" <NO-REPLY-LIBRARY@Virginia.EDU>',
        to: '',
        subject: '',
        text: '',
        html: ''
    };

    //    return mailTransport.sendMail(patronOptions)
    //        .then(() => console.log(`Sent email regarding request ${requestId}`))
    //        .catch((error) => console.error('There was an error while sending the email:', error));

    // Identify the request type and process...
    if (reqDetails.form_id === 'purchase_requests') {
        console.log(`purchase request: ${requestId}`);
        return processPurchaseRequest(requestId, newRequest.timestamp, reqDetails, libraryOptions, patronOptions);
    } else if (reqDetails.form_id === 'government_information_contact_u') {
        console.log(`gov docs request: ${requestId}`);
        return processGovernmentInformationRequest(requestId, newRequest.timestamp, reqDetails, libraryOptions, patronOptions);
    } else {
        return null;
    }
    /*    switch (reqDetails.form_id) {
            case 'purchase_requests':
                console.log(`purchase request: ${requestId}`);
                return processPurchaseRequest(requestId, newRequest.timestamp, reqDetails, libraryOptions, patronOptions);
            case 'government_information_contact_u':
                console.log(`gov docs request: ${requestId}`);
                return processGovernmentInformationRequest(requestId, newRequest.timestamp, reqDetails, libraryOptions, patronOptions);
            default:
                return null;
        }*/

});

function processPurchaseRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let inputs = msg = '';
    let data = {};

    // Prepare email content for Library staff and LibInsight data parameters
    libOptions.from = frmData.fldset_requestor_information.fld_email_address.value;
    libOptions.replyTo = frmData.fldset_requestor_information.fld_email_address.value;
    // @TODO Routing varies based on format and if for reserves...
    libOptions.to = 'jlk4p@virginia.edu';
    libOptions.subject = 'Purchase Request';
    libOptions.text = 'This is where the fields and their values would be displayed...';
    request['libEmailOptions'] = libOptions;
    // Prepare email confirmation content for patron
    userOptions.to = frmData.fldset_requestor_information.fld_email_address.value;
    userOptions.subject = 'Purchase Request';
    userOptions.text = 'This is where the fields and their values would be displayed...';
    request['patronEmailOptions'] = userOptions;
    // @TODO Process input in preparation for posting to Springshare LibInsight

}

function processGovernmentInformationRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let inputs = msg = '';
    let data = { 'field_619': reqId, 'ts_start': submitted };
    let promises = [];
    let results = {};

    // Prepare email message body and LibInsight data parameters
    if (frmData.fld_uva_computing_id.value) {
        inputs += "<strong>UVA Computing ID, e.g. mst3k:</strong> " + frmData.fld_uva_computing_id.value + "<br>\n";
        data['field_622'] = frmData.fld_uva_computing_id.value;
    }
    if (frmData.fld_name.value) {
        inputs += "<strong>Name:</strong> " + frmData.fld_name.value + "<br>\n";
        data['field_623'] = frmData.fld_name.value;
    }
    if (frmData.fld_email_address.value) {
        inputs += "<strong>Email address:</strong> " + frmData.fld_email_address.value + "<br>\n";
        data['field_624'] = frmData.fld_email_address.value;
    }
    if (frmData.fldset_question_or_comment.fld_enter_your_question_or_comment_regarding_governement_resourc.value) {
        inputs += "<h1>Question or Comment<h1>\n\n<p>" + frmData.fldset_question_or_comment.fld_enter_your_question_or_comment_regarding_governement_resourc.value + "</p><br>\n";
        data['field_625'] = frmData.fldset_question_or_comment.fld_enter_your_question_or_comment_regarding_governement_resourc.value;
    }
    msg = "<p>The question below was submitted through the Government Information Resources Contact Us page:</p><br>\n\n";

    // Prepare email content for Library staff
    // @TODO Routing goes to Govtinfo address in production: govtinfo@groups.mail.virginia.edu
    libOptions.from = frmData.fld_email_address.value;
    libOptions.replyTo = frmData.fld_email_address.value;
    libOptions.to = 'jlk4p@virginia.edu';
    libOptions.subject = 'Reference Referral';
    libOptions.html = msg + inputs;
    libOptions.text = stripHtml(msg + inputs);
    promises['library_notification'] = mailTransport.sendMail(libOptions);

    // Prepare email confirmation content for patron
    msg = "<p>Your request (copied below) has been received and will be referred to Government Information Resources.</p><br>\n\n";
    userOptions.from = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.replyTo = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.to = frmData.fld_email_address.value;
    userOptions.subject = 'Your reference referral';
    userOptions.html = msg + inputs;
    userOptions.text = stripHtml(msg + inputs);
    promises['patron_notification'] = mailTransport.sendMail(userOptions);

    // Post to LibInsight
    promises['LibInsight'] = request.post({
        url: 'https://virginia.libinsight.com/add.php?wid=7&type=5&token=bb329274df6e4be51624cfe7f955b7eb',
        form: data
    });

    Promise.all(promises)
        .then(responses => {
            let errors = false;
            if (responses['library_notification'].err) {
                errors = true;
                console.log(`Request ${reqId} library notification failed: ${responses['library_notification'].err.toString()}`);
            } else {
                results.library_notification = 'succeeded';
            }
            if (responses['patron_notification'].err) {
                errors = true;
                console.log(`Request ${reqId} patron notification failed: ${responses['patron_notification'].err.toString()}`);
            } else {
                results.patron_notification = 'succeeded';
            }
            if (!responses['LibInsight'].response) {
                errors = true;
                console.log(`Request ${reqId} LibInsight POST failed.`);
            } else {
                results.LibInsight = 'succeeded';
            }
            return results;
        })
        .catch(error => {
            console.log(error);
            // empty results would be adequate to indicate an error
            return results;
        });
}