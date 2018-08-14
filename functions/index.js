const functions = require('firebase-functions');
const nodemailer = require('nodemailer');

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
    let results = Array();
    console.log(`details: ${reqDetails.toString()}`);
    console.log(`when: ${when.toString()}`);

    // @TODO Validation of required inputs before we consider anything and redirect back to form???
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
        from: '"UVA Library" <NO-REPLY-LIBRARY@Virginia.EDU>',
        replyTo: '"UVA Library" <NO-REPLY-LIBRARY@Virginia.EDU>',
        to: 'jkelly@virginia.edu',
        subject: 'This is a test',
        text: 'Testing to see if the script successfully executes and sends email.',
        html: '<p>Testing to see if the script <em>successfully</em> executes and sends email.</p>'
    };

    return mailTransport.sendMail(patronOptions)
        .then(() => console.log(`Sent email regarding request ${requestId}`))
        .catch((error) => console.error('There was an error while sending the email:', error));

    // Identify the request type and process...
    /*    switch (reqDetails.form_id) {
            case 'purchase_requests':
                console.log('purchase request');
                results = prepPurchaseRequestInfo(reqDetails, libraryOptions, patronOptions);
                break;
            case 'government_information_contact_u':
                console.log('gov docs request');
                results = prepGovernmentInformationRequest(reqDetails, libraryOptions, patronOptions);
                break;
            default:
                results = [];
                break;
        }

        // If a valid form then send notifications and save data to LibInsight.
        if (results.length > 0) {
            // If the form submission is valid then continue...
            if (results['valid']) {
                            const tasks = [];
                            tasks.push(mailTransport.sendEmail(results['libEmailOptions']));
                            tasks.push(mailTransport.sendEmail(results['patronEmailOptions']));
                            tasks.push(saveToLibInsight['']);
                            // @TODO if the request required authentication, then update the status for the request to received?
                            return Promise.all(tasks); 
                return mailTransport.sendMail(results['libEmailOptions'])
                    .then(() => {
                        console.log('Library notification sent/received request');

                        //@TODO update request status for those requests that required authentication

                        return mailTransport.sendMail(results['patronEmailOptions']);
                    })
                    .catch(error => {
                        console.log(error);
                        return Promise.reject(new Error(error));
                    });
            } else {
                // return a Promise error?
                console.log(`Error sending notifications for request ${requestId}.`);
            }
        } else {
            console.log(`Error preparing request ${requestId}.`);
        }
        return null;*/
});

function prepPurchaseRequestInfo(frmData, libOptions, userOptions) {
    let inputs = '',
        request = Array();
    request['valid'] = false;

    request['valid'] = true; // set after inputs validated and email body constructed

    // Prepare email content for Library staff
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

    return request;
}

function prepGovernmentInformationRequest(frmData, libOptions, userOptions) {
    let inputs = '',
        request = Array();
    request['valid'] = false;

    // Prepare email message body.
    if (frmData.fld_uva_computing_id) {
        inputs += "UVA Computing ID, e.g. mst3k: " + frmData.fld_uva_computing_id.value + "\n";
    }
    if (frmData.fld_name.value && frmData.fld_email_address.value && frmData.fldset_question_or_comment.fld_enter_your_question_or_comment_regarding_governement_resourc.value) {
        request['valid'] = true;
        inputs += "Name: " + frmData.fld_name.value + "\n";
        inputs += "Email address: " + frmData.fld_email_address.value + "\n";
        inputs += "Question or Comment\n" + frmData.fldset_question_or_comment.fld_enter_your_question_or_comment_regarding_governement_resourc.value + "\n";
    }

    // Prepare email content for Library staff
    // @TODO Routing goes to Govtinfo address in production: govtinfo@groups.mail.virginia.edu
    libOptions.from = frmData.fld_email_address.value;
    libOptions.replyTo = frmData.fld_email_address.value;
    libOptions.to = 'jlk4p@virginia.edu';
    libOptions.subject = 'Reference Referral';
    libOptions.text = "The question below was submitted through the Government Information Resources Contact Us page:\n\n";
    libOptions.text += inputs;
    request['libEmailOptions'] = libOptions;
    // Prepare email confirmation content for patron
    userOptions.from = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.replyTo = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.to = frmData.fld_email_address.value;
    userOptions.subject = 'Your reference referral';
    userOptions.text = "Your request (copied below) has been received and will be referred to Government Information Resources.\n\n";
    userOptions.text += inputs;
    request['patronEmailOptions'] = userOptions;
    // @TODO Process input in preparation for posting to Springshare LibInsight

    return request;
}