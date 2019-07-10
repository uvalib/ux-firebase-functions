const functions = require('firebase-functions');
const nodemailer = require('nodemailer');
const request = require('request');
const stripHtml = require('string-strip-html');

// Environment variables configured for use with sending emails and saving data to LibInsight for forms.
// See https://firebase.google.com/docs/functions/config-env
const gmailEmail = functions.config().gmail.formsemail;
const gmailPassword = functions.config().gmail.formspassword;
const emailSecret = functions.config().email.secret;
const emailUrl = 'https://api.library.virginia.edu/mailer/mailer.js';
const purchaseRecommendationDatasetApi = functions.config().libinsighturl.purchaserecommendation;
const governmentInformationDatasetApi = functions.config().libinsighturl.governmentinformation;

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
    const reqDetails = JSON.parse(newRequest.submission);
    const formId = getFormId(reqDetails);
    const when = new Date(newRequest.timestamp);
    console.log(`newRequest: ${newRequest.submission}`);
    console.log(`form_id: ${formId}`);

    // Initialize email routing/content.
    let libraryOptions = {
        from: '"UVA Library" <no-reply-library@Virginia.EDU>',
        replyTo: '',
        to: '',
        bcc: '',
        subject: '',
        text: '',
        html: '',
        secret: emailSecret
    };
    let patronOptions = {
        from: '"UVA Library" <no-reply-library@Virginia.EDU>',
        replyTo: '"UVA Library" <NO-REPLY-LIBRARY@Virginia.EDU>',
        to: '',
        bcc: '',
        subject: '',
        text: '',
        html: '',
        secret: emailSecret
    };

    // Identify the request type and process...
    const formFields = getFormFields(reqDetails);
    if (formId === 'purchase_requests') {
        console.log(`purchase request: ${requestId}`);
        return processPurchaseRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'class_visits_and_instruction') {
        console.log(`class visit and instruction request: ${requestId}`);
        return processClassVisitAndInstructionRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'government_information_contact_u') {
        console.log(`gov docs request: ${requestId}`);
        return processGovernmentInformationRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else {
        return null;
    }

});

function getFormId(formDefn) {
    let i = 0;
    let form_id = '';
    while (i < formDefn.length) {
        if (formDefn[i].webform && formDefn[i].webform !== '') {
            form_id = formDefn[i].webform;
            break;
        }
        i++;
    }
    return form_id;
}

function getFormFields(formDefn) {
    let i = 0;
    let fields = {};
    while (i < formDefn.length) {
        let field = formDefn[i].webform_key;
        if (field.match(/^sect_/)) {
            fields[field] = { title: formDefn[i].title, fields: getSectionFields(formDefn[i]) };
        } else if (field.match(/^fld_|authenticated/)) {
            fields[field] = { label: formDefn[i].title, value: formDefn[i].value };
        } else if (field.match(/^fldset_/)) {
            // @TODO need to flesh this out some depending on ways might use this down the road...
        }
        i++;
    }
    return fields;
}

function getSectionFields(section) {
    let fields = {};
    for (var key in section) {
        if (key.match(/^fld_/)) {
            fields[key] = { label: section[key].title, value: section[key].value };
        }
        // @TODO address fieldset down the road?
    }
    return fields;
}

function processPurchaseRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let adminMsg = subjPre = courseInfo = biblioInfo = requestorInfo = '';
    let patronMsg = "<p>A copy of your purchase recommendation is shown below.</p><br>\n\n";
    let data = { 'field_642': reqId, 'ts_start': submitted };
    let promises = [];
    let results = {};

    console.log(`frmData: ${JSON.stringify(frmData)}`);
    // Prepare email message body and LibInsight data parameters
    // The admin message has a few fields out of order placed at the top.
    // Fund Code and library location are internal fields defined for use in routing to Acquisitions and Collections Mgmt.
    // Fund code value depends on if the item is for reserve and what format the item is. 
    // Library location depends on if the item is for reserve and which library location was specified.
    // Since fund code and library location are for admin purposes, they will not get saved to LibInsight data.
    let msg = fundCode = libraryLocation = "";
    if (frmData.fld_is_this_for_course_reserves_.value) {
        if (frmData.fld_is_this_for_course_reserves_.value === "Yes") {
            if ((frmData.fld_format.value === "Book") || (frmData.fld_format.value === "eBook") || (frmData.fld_format.value === "Dissertation or Thesis") || (frmData.fld_format.value === "Music Recording")) {
                fundCode = "UL-RESERVES";
                libraryLocation = "LC CLASS"; // library where typical call number gets housed
            }
        } else {
            if ((frmData.fld_format.value === "Book") || (frmData.fld_format.value === "eBook") || (frmData.fld_format.value === "Music Recording") || (frmData.fld_format.value === "Music Score")) {
                fundCode = "UL-REQUESTS";
                libraryLocation = (frmData.fld_format.value !== "Music Recording") ? "LC CLASS" : "Music";
            }
            libraryLocation = (frmData.fld_format.value !== "Music Recording") ? "LC CLASS" : "Music";
        }
    }
    libraryLocation = (frmData.fld_format.value === "Music Score") ? "Music" : libraryLocation;
    adminMsg += "<strong>Fund code:</strong> " + fundCode + "<br>\n";
    adminMsg += "<strong>Library location:</strong> " + libraryLocation + "<br>\n";
    if (frmData.fld_is_this_for_course_reserves_.value) {
        if (frmData.fld_is_this_for_course_reserves_.value === "Yes") {
            if (frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value) {
                adminMsg += "<strong>Library reserve hold location:</strong> " + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value + "<br>\n";
            }
            if (frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value) {
                adminMsg += "<strong>Library reserve loan period:</strong> " + frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value + "<br>\n";
            }
        }
    }

    if (frmData.fld_format.value) {
        msg = "<strong>" + frmData.fld_format.label + ":</strong> " + frmData.fld_format.value + "<br>\n";
        adminMsg += msg;
        patronMsg += msg;
        data['field_645'] = frmData.fld_format.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available_.value) {
        msg = "<strong>" + frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available_.label + ":</strong> ";
        msg += (frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available_.value === 1) ? 'Yes' : 'No';
        msg += "<br>\n";
        adminMsg += msg;
        patronMsg += msg;
        data['field_683'] = (frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available_.value === 1) ? 'Yes' : 'No';
    }
    if (frmData.sect_bibliographic_information.fields.fld_if_ebook_not_available_order_print_version.value) {
        msg = "<strong>" + frmData.sect_bibliographic_information.fields.fld_if_ebook_not_available_order_print_version.label + ":</strong> ";
        msg += (frmData.sect_bibliographic_information.fields.fld_if_ebook_not_available_order_print_version.value === 1) ? 'Yes' : 'No';
        msg += "<br>\n";
        adminMsg += msg;
        patronMsg += msg;
        data['field_793'] = (frmData.sect_bibliographic_information.fields.fld_if_ebook_not_available_order_print_version.value === 1) ? 'Yes' : 'No';
    }
    if (frmData.fld_which_type_of_request_is_this_.value) {
        // This type of request input is only appropriate to book/ebook format emails.
        if ((frmData.fld_format.value === 'Book') || (frmData.fld_format.value === 'eBook')) {
            msg = "<strong>Type of request:</strong> " + frmData.fld_which_type_of_request_is_this_.value + "<br>\n";
            adminMsg += msg;
            patronMsg += msg;
            // set the subject line prefix to the appropriate string
            subjPre = (frmData.fld_which_type_of_request_is_this_.value === 'Not needed immediately') ? 'Non-rush' : 'Rush';
        } else {
            subjPre = 'Non-rush';
        }
        data['field_646'] = frmData.fld_which_type_of_request_is_this_.value;
    } else {
        subjPre = 'Non-rush';
    }
    if (frmData.fld_is_this_for_course_reserves_.value) {
        if (frmData.fld_is_this_for_course_reserves_.value === "Yes") {
            adminMsg += "<strong>" + frmData.fld_is_this_for_course_reserves_.label + ":</strong> " + frmData.fld_is_this_for_course_reserves_.value + "<br>\n";
        }
        data['field_647'] = frmData.fld_is_this_for_course_reserves_.value;
        // Build course information output section and set appropriate LibInsight fields.
        if (frmData.fld_is_this_for_course_reserves_.value === "Yes") {
            courseInfo += "<h3>" + frmData.sect_course_information.title + "</h3>\n\n<p>";
            if (frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.label + ":</strong> " + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value + "<br>\n";
                data['field_655'] = frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value;
            }
            if (frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.label + ":</strong> " + frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value + "<br>\n";
                data['field_708'] = frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value;
            }
            if (frmData.sect_course_information.fields.fld_course_section_selector.value) {
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.term) {
                    courseInfo += "<strong>Term:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.term + "<br>\n";
                    data['field_648'] = frmData.sect_course_information.fields.fld_course_section_selector.value.term;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.course) {
                    courseInfo += "<strong>Course:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.course + "<br>\n";
                    data['field_649'] = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.section) {
                    courseInfo += "<strong>Section:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.section + "<br>\n";
                    data['field_650'] = frmData.sect_course_information.fields.fld_course_section_selector.value.section;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse) {
                    courseInfo += "<strong>Alternate course:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse + "<br>\n";
                    data['field_651'] = frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.altSection) {
                    courseInfo += "<strong>Alternate course section:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.altSection + "<br>\n";
                    data['field_652'] = frmData.sect_course_information.fields.fld_course_section_selector.value.altSection;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.title) {
                    courseInfo += "<strong>Title:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.title + "<br>\n";
                    data['field_653'] = frmData.sect_course_information.fields.fld_course_section_selector.value.title;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment) {
                    courseInfo += "<strong>Enrollment:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment + "<br>\n";
                    data['field_654'] = frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment;
                }
            }
            courseInfo += "</p><br>\n";
        }
        // Create requestor info output content and set appropriate LibInsight fields.
        requestorInfo += "<h3>";
        requestorInfo += (frmData.fld_is_this_for_course_reserves_.value === "Yes") ? "Requested" : "Suggested";
        requestorInfo += " by</h3>\n\n<p>";
        if (frmData.sect_requestor_information.fields.fld_name.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_name.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_name.value + "<br>\n";
            data['field_687'] = frmData.sect_requestor_information.fields.fld_name.value;
        }
        if (frmData.sect_requestor_information.fields.fld_email_address.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_email_address.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_email_address.value + "<br>\n";
            data['field_688'] = frmData.sect_requestor_information.fields.fld_email_address.value;
        }
        if (frmData.sect_requestor_information.fields.fld_uva_computing_id.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_uva_computing_id.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_uva_computing_id.value + "<br>\n";
            data['field_686'] = frmData.sect_requestor_information.fields.fld_uva_computing_id.value;
        }
        if (frmData.sect_requestor_information.fields.fld_phone_number.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_phone_number.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_phone_number.value + "<br>\n";
            data['field_689'] = frmData.sect_requestor_information.fields.fld_phone_number.value;
        }
        if (frmData.sect_requestor_information.fields.fld_university_affiliation.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_university_affiliation.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_university_affiliation.value + "<br>\n";
            data['field_690'] = frmData.sect_requestor_information.fields.fld_university_affiliation.value;
        }
        if (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value + "<br>\n";
            data['field_691'] = frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value;
            if (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value === "Other...") {
                requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_other_lib_department_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_other_lib_department_school.value + "<br>\n";
                data['field_751'] = frmData.sect_requestor_information.fields.fld_other_lib_department_school.value;
            }
        }
        // The primary dept/school from LDAP is for internal use only within LibInsight. Not needed in email.
        if (frmData.sect_requestor_information.fields.fld_university_department_or_school.value) {
            //requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_university_department_or_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_university_department_or_school.value + "<br>\n";
            data['field_750'] = frmData.sect_requestor_information.fields.fld_university_department_or_school.value;
        }
        // Create format's bibliographic info output and set appropriate LibInsight fields.
        biblioInfo += "<h3>" + frmData.sect_bibliographic_information.title + "</h3>\n\n<p>";
        if (frmData.sect_bibliographic_information.fields.fld_isbn.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_isbn.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_isbn.value + "<br>\n";
            data['field_671'] = frmData.sect_bibliographic_information.fields.fld_isbn.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_title.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_title.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_title.value + "<br>\n";
            data['field_656'] = frmData.sect_bibliographic_information.fields.fld_title.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_name_title.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_name_title.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_name_title.value + "<br>\n";
            data['field_657'] = frmData.sect_bibliographic_information.fields.fld_name_title.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_author_editor.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_author_editor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_author_editor.value + "<br>\n";
            data['field_658'] = frmData.sect_bibliographic_information.fields.fld_author_editor.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_author.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_author.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_author.value + "<br>\n";
            data['field_659'] = frmData.sect_bibliographic_information.fields.fld_author.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_director.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_director.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_director.value + "<br>\n";
            data['field_660'] = frmData.sect_bibliographic_information.fields.fld_director.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.value + "<br>\n";
            data['field_661'] = frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_performer_s_.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_performer_s_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_performer_s_.value + "<br>\n";
            data['field_662'] = frmData.sect_bibliographic_information.fields.fld_performer_s_.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_composer_editor.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_composer_editor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_composer_editor.value + "<br>\n";
            data['field_663'] = frmData.sect_bibliographic_information.fields.fld_composer_editor.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_publisher.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_publisher.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_publisher.value + "<br>\n";
            data['field_664'] = frmData.sect_bibliographic_information.fields.fld_publisher.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.value + "<br>\n";
            data['field_665'] = frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_publisher_vendor.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_publisher_vendor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_publisher_vendor.value + "<br>\n";
            data['field_666'] = frmData.sect_bibliographic_information.fields.fld_publisher_vendor.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.value + "<br>\n";
            data['field_667'] = frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.value + "<br>\n";
            data['field_668'] = frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_record_label.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_record_label.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_record_label.value + "<br>\n";
            data['field_669'] = frmData.sect_bibliographic_information.fields.fld_record_label.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_date_of_publication.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_date_of_publication.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_date_of_publication.value + "<br>\n";
            data['field_670'] = frmData.sect_bibliographic_information.fields.fld_date_of_publication.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_release_date.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_release_date.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_release_date.value + "<br>\n";
            data['field_672'] = frmData.sect_bibliographic_information.fields.fld_release_date.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_year_of_publication.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_year_of_publication.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_year_of_publication.value + "<br>\n";
            data['field_673'] = frmData.sect_bibliographic_information.fields.fld_year_of_publication.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_production_date.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_production_date.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_production_date.value + "<br>\n";
            data['field_674'] = frmData.sect_bibliographic_information.fields.fld_production_date.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_edition.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_edition.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_edition.value + "<br>\n";
            data['field_675'] = frmData.sect_bibliographic_information.fields.fld_edition.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_edition_version.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_edition_version.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_edition_version.value + "<br>\n";
            data['field_676'] = frmData.sect_bibliographic_information.fields.fld_edition_version.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not_.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not_.value + "<br>\n";
            data['field_678'] = frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not_.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not_.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not_.value + "<br>\n";
            data['field_679'] = frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not_.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_and_or_students_might_use_this_res.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_and_or_students_might_use_this_res.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_and_or_students_might_use_this_res.value + "<br>\n";
            data['field_680'] = frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_and_or_students_might_use_this_res.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.value + "<br>\n";
            data['field_681'] = frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_price.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_price.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_price.value + "<br>\n";
            data['field_682'] = frmData.sect_bibliographic_information.fields.fld_price.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_additional_comments.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_additional_comments.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_additional_comments.value + "<br>\n";
            data['field_684'] = frmData.sect_bibliographic_information.fields.fld_additional_comments.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_description_comments.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_description_comments.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_description_comments.value + "<br>\n";
            data['field_685'] = frmData.sect_bibliographic_information.fields.fld_description_comments.value;
        }
    }

    // Prepare email content for Library staff
    libOptions.subject = subjPre + ': ';
    libOptions.subject += (frmData.fld_is_this_for_course_reserves_.value && (frmData.fld_is_this_for_course_reserves_.value === "Yes")) ? 'Reserve ' : '';
    libOptions.subject += 'Purchase Recommendation ';
    libOptions.from = '"' + frmData.sect_requestor_information.fields.fld_name.value + '" <' + frmData.sect_requestor_information.fields.fld_email_address.value + '>';
    libOptions.replyTo = frmData.sect_requestor_information.fields.fld_email_address.value;
    // Routing varies based on format and if for reserves...
    if (frmData.fld_is_this_for_course_reserves_.value === 'Yes') {
        // course reserve purchases for music and video do not go to acquisitions.
        // book and dissertation requests go to acquisitions.
        if (frmData.fld_format.value === 'Video') {
            libOptions.to = 'lib-reserves@virginia.edu';
            libOptions.bcc = 'Libselect_video@virginia.edu';
            libOptions.subject += ' to Reserves Librarian';
        } else if (frmData.fld_format.value === 'Music Score') {
            libOptions.to = 'lib-reserves@virginia.edu,lb-mu-scores@virginia.edu';
            libOptions.subject += ' to Reserves Librarian';
        } else {
            libOptions.to = 'lib-reserves@virginia.edu';
            if (frmData.fld_format.value === 'Music Recording') {
                libOptions.to += ',lb-mu-recordings@virginia.edu';
            }
            if ((frmData.fld_format.value === 'Journal Subscription') || (frmData.fld_format.value === 'Other')) {
                libOptions.subject += 'to Reserves Librarian';
            } else if (frmData.fld_format.value === 'Database') {
                libOptions.to += ',lib-collections@virginia.edu,data@virginia.edu';
                libOptions.subject += 'to Reserves Librarian';
            } else if (frmData.fld_format.value === 'Dissertation or Thesis') {
                libOptions.to += ',lib-collections@virginia.edu';
                libOptions.subject += 'to Reserves Librarian';
            } else {
                libOptions.bcc += 'lib-orders@virginia.edu';
                libOptions.subject += 'to Acquisitions';
            }
        }
    } else {
        // not going on course reserve so gets routed...
        if (frmData.fld_format.value === 'Music Score') {
            libOptions.to = 'purchase-requests@virginia.libanswers.com,lb-mu-scores@virginia.edu';
            libOptions.subject += 'to Collection Librarians';
        } else if (frmData.fld_format.value === 'Music Recording') {
            libOptions.to = 'lb-mu-recordings@virginia.edu,lib-orders@virginia.edu';
            libOptions.subject += 'to Acquisitions';
        } else if (frmData.fld_format.value === 'Video') {
            libOptions.to = 'Libselect_video@virginia.edu';
            libOptions.subject += 'to Subject Librarian';
        } else if (frmData.fld_format.value === 'Database') {
            libOptions.to = 'purchase-requests@virginia.libanswers.com,data@virginia.edu';
            libOptions.subject += 'to Collection Librarians';
        } else {
            if (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value && (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value !== '')) {
                // Determine the routing based on the user department. Identify the subject librarian.
                switch (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value) {
                    case 'African-American and African Studies':
                        libOptions.to = 'lb-aaas-books@virginia.edu';
                        break;
                    case 'Anthropology':
                        libOptions.to = 'lib-anthropology-books@virginia.edu';
                        break;
                    case 'Archaeology':
                        libOptions.to = 'lib-archaeology-books@virginia.edu';
                        break;
                    case 'Architecture':
                    case 'Architectural History':
                    case 'Landscape Architecture':
                        libOptions.to = 'lib-architecture-books@virginia.edu';
                        break;
                    case 'Art':
                        libOptions.to = 'fal-purchase-req@virginia.edu';
                        break;
                    case 'Astronomy':
                        libOptions.to = 'lib-astronomy-books@virginia.edu';
                        break;
                    case 'Batten School':
                        libOptions.to = 'battenbooks@virginia.edu';
                        break;
                    case 'Biology':
                        libOptions.to = 'lib-biology-books@virginia.edu';
                        break;
                    case 'Biomedical Engineering':
                        libOptions.to = 'biomed-engineer-book@virginia.edu';
                        break;
                    case 'Chemical Engineering':
                        libOptions.to = 'chemical-engineer-book@virginia.edu';
                        break;
                    case 'Chemistry':
                        libOptions.to = 'lib-chemistry-books@virginia.edu';
                        break;
                    case 'Civil and Environmental Engineering':
                        libOptions.to = 'lib-civil-envi-books@virginia.edu';
                        break;
                    case 'Classics':
                        libOptions.to = 'lib-classics-books@virginia.edu';
                        break;
                    case 'Commerce':
                    case 'Economics':
                        libOptions.to = 'businessbooks@virginia.edu';
                        break;
                    case 'Computer Science':
                        libOptions.to = 'lib-comp-sci-books@virginia.edu';
                        break;
                    case 'Drama':
                        libOptions.to = 'lib-drama-books@virginia.edu';
                        break;
                    case 'East Asian':
                        libOptions.to = 'lib-east-asian-books@virginia.edu';
                        break;
                    case 'Education':
                        libOptions.to = 'Education@virginia.edu';
                        break;
                    case 'Electrical and Computer Engineering':
                        libOptions.to = 'lib-elec-comp-books@virginia.edu';
                        break;
                    case 'English':
                        libOptions.to = 'lb-english@virginia.edu';
                        break;
                    case 'Environmental Sciences':
                        libOptions.to = 'lib-env-sci-books@virginia.edu';
                        break;
                    case 'French':
                        libOptions.to = 'lib-french-books@virginia.edu';
                        break;
                    case 'German':
                        libOptions.to = 'germanbooks@virginia.edu';
                        break;
                    case 'History':
                        libOptions.to = 'historybooks@virginia.edu';
                        break;
                    case 'Library':
                        libOptions.to = 'lib-library-requests@virginia.edu';
                        break;
                    case 'Materials Science and Engineering':
                        libOptions.to = 'material-sci-eng-books@virginia.edu';
                        break;
                    case 'Mathematics':
                        libOptions.to = 'lib-mathematics-books@virginia.edu';
                        break;
                    case 'Mechanical and Aerospace Engineering':
                        libOptions.to = 'lib-mech-aero-books@virginia.edu';
                        break;
                    case 'Media Studies':
                        libOptions.to = 'lb-media-studies-books@virginia.edu';
                        break;
                    case 'Middle Eastern and South Asian':
                        libOptions.to = 'mideast-southasia-book@virginia.edu';
                        break;
                    case 'Music':
                        libOptions.to = 'lb-mu-books@virginia.edu';
                        break;
                    case 'Other...':
                        libOptions.to = 'lib-collections@virginia.edu';
                        break;
                    case 'Philosophy':
                        libOptions.to = 'philosophybooks@virginia.edu';
                        break;
                    case 'Physics':
                        libOptions.to = 'lib-physics-books@virginia.edu';
                        break;
                    case 'Politics':
                        libOptions.to = 'politicsbooks@virginia.edu';
                        break;
                    case 'Psychology':
                        libOptions.to = 'lib-psychology-books@virginia.edu';
                        break;
                    case 'Religious Studies':
                        libOptions.to = 'relstudiesbooks@virginia.edu';
                        break;
                    case 'Science, Technology and Society':
                        libOptions.to = 'sci-tech-society-books@virginia.edu';
                        break;
                    case 'Slavic':
                        libOptions.to = 'slavicbooks@virginia.edu';
                        break;
                    case 'Sociology':
                        libOptions.to = 'lb-Sociology@virginia.edu';
                        break;
                    case 'Spanish, Italian, and Portuguese':
                        libOptions.to = 'span-ital-port-books@virginia.edu';
                        break;
                    case 'Statistics':
                        libOptions.to = 'lib-statistics-books@virginia.edu';
                        break;
                    case 'Systems and Information Engineering':
                        libOptions.to = 'lib-sys-info-books@virginia.edu';
                        break;
                    case 'Women, Gender, & Sexuality':
                        libOptions.to = 'lb-wgsbooks@virginia.edu';
                        break;
                    default:
                        libOptions.to = 'purchase-requests@virginia.libanswers.com';
                }
                switch (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value) {
                    case 'African-American and African Studies':
                    case 'Anthropology':
                    case 'Archaeology':
                    case 'Classics':
                    case 'Architecture':
                    case 'Architectural History':
                    case 'Landscape Architecture':
                    case 'Art':
                    case 'Astronomy':
                    case 'Batten School':
                    case 'Biology':
                    case 'Biomedical Engineering':
                    case 'Chemical Engineering':
                    case 'Chemistry':
                    case 'Civil and Environmental Engineering':
                    case 'Commerce':
                    case 'Computer Science':
                    case 'Drama':
                    case 'East Asian':
                    case 'Economics':
                    case 'Electrical and Computer Engineering':
                    case 'Engineering':
                    case 'Education':
                    case 'English':
                    case 'Environmental Sciences':
                    case 'French':
                    case 'German':
                    case 'History':
                    case 'Materials Science and Engineering':
                    case 'Mathematics':
                    case 'Mechanical and Aerospace Engineering':
                    case 'Media Studies':
                    case 'Middle Eastern and South Asian':
                    case 'Music':
                    case 'Other...':
                    case 'Philosophy':
                    case 'Physics':
                    case 'Politics':
                    case 'Psychology':
                    case 'Religious Studies':
                    case 'Science, Technology and Society':
                    case 'Slavic':
                    case 'Sociology':
                    case 'Spanish, Italian, and Portuguese':
                    case 'Statistics':
                    case 'Systems and Information Engineering':
                    case 'Women, Gender, & Sexuality':
                        if ((frmData.fld_format.value === 'Book') || (frmData.fld_format.value === "eBook")) {
                            libOptions.to += ',lib-orders@virginia.edu,lib-collections@virginia.edu';
                            libOptions.subject += 'to Acquisitions';
                        } else if (frmData.fld_format.value === 'Dissertation or Thesis') {
                            libOptions.to += ',lib-collections@virginia.edu';
                            libOptions.subject += 'to Collection Librarians';
                        } else {
                            libOptions.subject += 'to Collection Librarians';
                            libOptions.to += ',purchase-requests@virginia.libanswers.com';
                        }
                        break;
                    default:
                        libOptions.subject += 'to Collection Librarians';
                }
            } else {
                libOptions.to = 'purchase-requests@virginia.libanswers.com';
                libOptions.subject += 'to Collection Librarians';
            }
        }

    }
    // @TODO comment out the two lines below when ready to test final routing before going live.
    //libOptions.to = 'lib-ux-testing@virginia.edu';
    //libOptions.bcc = '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    libOptions.html = adminMsg + biblioInfo + requestorInfo + courseInfo + reqText;
    libOptions.text = stripHtml(adminMsg + biblioInfo + requestorInfo + courseInfo + reqText);
    //promises[0] = mailTransport.sendMail(libOptions);
    promises[0] = request.post({ url: emailUrl, form: libOptions });

    // Prepare email confirmation content for patron
    userOptions.subject = (frmData.fld_is_this_for_course_reserves_.value && (frmData.fld_is_this_for_course_reserves_.value === "Yes")) ? 'Reserve ' : '';
    userOptions.subject += 'Purchase Recommendation';
    userOptions.to = frmData.sect_requestor_information.fields.fld_email_address.value;
    userOptions.html = patronMsg + biblioInfo + requestorInfo + courseInfo + reqText;
    userOptions.text = stripHtml(patronMsg + biblioInfo + requestorInfo + courseInfo + reqText);
    //promises[1] = mailTransport.sendMail(userOptions);
    promises[1] = request.post({ url: emailUrl, form: userOptions });

    // Post to LibInsight
    promises[2] = request.post({
        url: purchaseRecommendationDatasetApi,
        form: data
    });

    return Promise.all(promises)
        .then(responses => {
            let errors = false;
            if (responses[0].err) {
                errors = true;
                console.log(`Request ${reqId} library notification failed: ${responses['library_notification'].err.toString()}`);
            } else {
                results.library_notification = 'succeeded';
            }
            if (responses[1].err) {
                errors = true;
                console.log(`Request ${reqId} patron notification failed: ${responses['patron_notification'].err.toString()}`);
            } else {
                results.patron_notification = 'succeeded';
            }
            if (!responses[2].response) {
                errors = true;
                console.log(`LibInsight failure: ${JSON.stringify(responses[2])}`);
                console.log(`Request ${reqId} LibInsight POST failed.`);
            } else {
                console.log(`LibInsight success: ${JSON.stringify(responses[2])}`);
                results.LibInsight = 'succeeded';
            }
            if (errors) {
                return errors;
            } else {
                console.log(`results: ${JSON.stringify(results)}`);
                return results;
            }
        })
        .catch(error => {
            // empty results would be adequate to indicate an error
            console.log(`error: ${JSON.stringify(error)}`);
            return error;
        });
}

function processClassVisitAndInstructionRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let inputs = msg = '';
    let data = { 'field_DDD': reqId, 'ts_start': submitted };
    let promises = [];
    let results = {};
    console.log(`frmData: ${JSON.stringify(frmData)}`);
}

function processGovernmentInformationRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let inputs = msg = '';
    let data = { 'field_619': reqId, 'ts_start': submitted };
    let promises = [];
    let results = {};

    console.log(`frmData: ${JSON.stringify(frmData)}`);
    // Prepare email message body and LibInsight data parameters
    if (frmData.fld_name.value) {
        inputs += "<strong>" + frmData.fld_name.label + ":</strong> " + frmData.fld_name.value + "<br>\n";
        data['field_623'] = frmData.fld_name.value;
    }
    if (frmData.fld_email_address.value) {
        inputs += "<strong>" + frmData.fld_email_address.label + ":</strong> " + frmData.fld_email_address.value + "<br>\n";
        data['field_624'] = frmData.fld_email_address.value;
    }
    if (frmData.sect_question_or_comment.fields.fld_enter_your_question_or_comment_regarding_governement_resourc.value) {
        inputs += "<h3>" + frmData.sect_question_or_comment.title + "</h3>\n\n<p>" + frmData.sect_question_or_comment.fields.fld_enter_your_question_or_comment_regarding_governement_resourc.value + "</p><br>\n";
        data['field_625'] = frmData.sect_question_or_comment.fields.fld_enter_your_question_or_comment_regarding_governement_resourc.value;
    }
    msg = "<p>The question below was submitted through the Government Information Resources Contact Us page:</p><br>\n\n";

    // Prepare email content for Library staff
    // @TODO Routing goes to Govtinfo address in production: govtinfo@groups.mail.virginia.edu
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;

    //libOptions.from = frmData.fld_email_address.value;
    libOptions.replyTo = frmData.fld_email_address.value;
    libOptions.to = 'jlk4p@virginia.edu';
    libOptions.subject = 'Reference Referral';
    libOptions.html = msg + inputs + reqText;
    libOptions.text = stripHtml(msg + inputs + reqText);
    promises[0] = mailTransport.sendMail(libOptions);

    // Prepare email confirmation content for patron
    msg = "<p>Your request (copied below) has been received and will be referred to Government Information Resources.</p><br>\n\n";
    userOptions.from = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.replyTo = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.to = frmData.fld_email_address.value;
    userOptions.subject = 'Your reference referral';
    userOptions.html = msg + inputs + reqText;
    userOptions.text = stripHtml(msg + inputs + reqText);
    promises[1] = mailTransport.sendMail(userOptions);

    // Post to LibInsight
    promises[2] = request.post({
        url: governmentInformationDatasetApi,
        form: data
    });

    return Promise.all(promises)
        .then(responses => {
            let errors = false;
            if (responses[0].err) {
                errors = true;
                console.log(`Request ${reqId} library notification failed: ${responses['library_notification'].err.toString()}`);
            } else {
                results.library_notification = 'succeeded';
            }
            if (responses[1].err) {
                errors = true;
                console.log(`Request ${reqId} patron notification failed: ${responses['patron_notification'].err.toString()}`);
            } else {
                results.patron_notification = 'succeeded';
            }
            if (!responses[2].response) {
                errors = true;
                console.log(`LibInsight failure: ${JSON.stringify(responses[2])}`);
                console.log(`Request ${reqId} LibInsight POST failed.`);
            } else {
                console.log(`LibInsight success: ${JSON.stringify(responses[2])}`);
                results.LibInsight = 'succeeded';
            }
            if (errors) {
                return errors;
            } else {
                console.log(`results: ${JSON.stringify(results)}`);
                return results;
            }
        })
        .catch(error => {
            // empty results would be adequate to indicate an error
            console.log(`error: ${JSON.stringify(error)}`);
            return error;
        });
}