const functions = require('firebase-functions');
const nodemailer = require('nodemailer');
const request = require('request');
const stripHtml = require('string-strip-html');

// Environment variables configured for use with sending emails and saving data to LibInsight for forms.
// See https://firebase.google.com/docs/functions/config-env
const gmailEmail = functions.config().gmail.formsemail;
const gmailPassword = functions.config().gmail.formspassword;
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
    //console.log(newRequest);
    console.log(`newRequest: ${newRequest.submission}`);
    console.log(`details: ${JSON.stringify(reqDetails)}`);
    console.log(`form_id: ${formId}`);
    console.log(`when: ${when.toString()}`);

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

    // Identify the request type and process...
    const formFields = getFormFields(reqDetails);
    if (formId === 'purchase_requests') {
        console.log(`purchase request: ${requestId}`);
        return processPurchaseRequest(requestId, when, formFields, libraryOptions, patronOptions);
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
            if ((frmData.fld_format.value === "Book") || (frmData.fld_format.value === "Dissertation or Thesis") || (frmData.fld_format.value === "Music Recording")) {
                fundCode = "UL-RESERVES";
                if (frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value === "Clemons") {
                    libraryLocation = "Clemons";
                } else {
                    libraryLocation = "LC CLASS"; // library whiere typical call number gets housed
                }
            }
        } else {
            if ((frmData.fld_format.value === "Book") || (frmData.fld_format.value === "Music Recording") || (frmData.fld_format.value === "Music Score")) {
                fundCode = "UL-REQUESTS";
                libraryLocation = (frmData.fld_format.value !== "Music Recording") ? "LC CLASS" : "Music";
            }
            libraryLocation = (frmData.fld_format.value !== "Music Recording") ? "LC CLASS" : "Music";
        }
    }
    libraryLocation = (frmData.fld_format.value === "Music Score") ? "Music" : libraryLocation;
    adminMsg += "<strong>Fund code:</strong> " + fundCode + "<br>\n";
    adminMsg += "<strong>Library location:</strong> " + libraryLocation + "<br>\n";
    if (frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value) {
        adminMsg += "<strong>Library reserve hold location:</strong> " + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value + "<br>\n";
    }
    if (frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value) {
        adminMsg += "<strong>Library reserve loan period:</strong> " + frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value + "<br>\n";
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
    if (frmData.fld_which_type_of_request_is_this_.value) {
        msg = "<strong>Type of request:</strong> " + frmData.fld_which_type_of_request_is_this_.value + "<br>\n";
        adminMsg += msg;
        patronMsg += msg;
        data['field_646'] = frmData.fld_which_type_of_request_is_this_.value;
        // set the subject line prefix to the appropriate string based on this type of request but truncate the string.
        subjPre = frmData.fld_which_type_of_request_is_this_.value.substring(0, frmData.fld_which_type_of_request_is_this_.value.indexOf('('));
    }
    if (frmData.fld_is_this_for_course_reserves_.value) {
        adminMsg += "<strong>" + frmData.fld_is_this_for_course_reserves_.label + ":</strong> " + frmData.fld_is_this_for_course_reserves_.value + "<br>\n";
        data['field_647'] = frmData.fld_is_this_for_course_reserves_.value;
        // Build course information output section and set appropriate LibInsight fields.
        if (frmData.fld_is_this_for_course_reserves_.value === "Yes") {
            courseInfo += "<h2>" + frmData.sect_course_information.title + "</h2>\n\n<p>";
            if (frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.label + ":</strong> " + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value + "<br>\n";
                data['field_655'] = frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value;
            }
            if (frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.label + ":</strong> " + frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value + "<br>\n";
                data['field_708'] = frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value;
            }
            if (frmData.sect_course_information.fields.fld_term.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_term.label + ":</strong> " + frmData.sect_course_information.fields.fld_term.value + "<br>\n";
                data['field_648'] = frmData.sect_course_information.fields.fld_term.value;
            }
            if (frmData.sect_course_information.fields.fld_course_e_g_mdst_3840.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_course_e_g_mdst_3840.label + ":</strong> " + frmData.sect_course_information.fields.fld_course_e_g_mdst_3840.value + "<br>\n";
                data['field_649'] = frmData.sect_course_information.fields.fld_course_e_g_mdst_3840.value;
            }
            if (frmData.sect_course_information.fields.fld_course_section_e_g_100.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_course_section_e_g_100.label + ":</strong> " + frmData.sect_course_information.fields.fld_course_section_e_g_100.value + "<br>\n";
                data['field_650'] = frmData.sect_course_information.fields.fld_course_section_e_g_100.value;
            }
            if (frmData.sect_course_information.fields.fld_alternate_course_e_g_dram_3840.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_alternate_course_e_g_dram_3840.label + ":</strong> " + frmData.sect_course_information.fields.fld_alternate_course_e_g_dram_3840.value + "<br>\n";
                data['field_651'] = frmData.sect_course_information.fields.fld_alternate_course_e_g_dram_3840.value;
            }
            if (frmData.sect_course_information.fields.fld_alternate_course_section_e_g_101.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_alternate_course_section_e_g_101.label + ":</strong> " + frmData.sect_course_information.fields.fld_alternate_course_section_e_g_101.value + "<br>\n";
                data['field_652'] = frmData.sect_course_information.fields.fld_alternate_course_section_e_g_101.value;
            }
            if (frmData.sect_course_information.fields.fld_course_title.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_course_title.label + ":</strong> " + frmData.sect_course_information.fields.fld_course_title.value + "<br>\n";
                data['field_653'] = frmData.sect_course_information.fields.fld_course_title.value;
            }
            if (frmData.sect_course_information.fields.fld_enrollment.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_enrollment.label + ":</strong> " + frmData.sect_course_information.fields.fld_enrollment.value + "<br>\n";
                data['field_654'] = frmData.sect_course_information.fields.fld_enrollment.value;
            }
            courseInfo += "</p><br>\n";
        }
        // Create requestor info output content and set appropriate LibInsight fields.
        requestorInfo += "<h2>";
        requestorInfo += (frmData.fld_is_this_for_course_reserves_.value === "Yes") ? "Requested" : "Suggested";
        requestorInfo += " by</h2>\n\n<p>";
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
            if (frmData.sect_requestor_information.fields.fld_other_lib_department_school.value && frmData.sect_requestor_information.fields.fld_other_lib_department_school.value !== "") {
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
        biblioInfo += "<h2>" + frmData.sect_bibliographic_information.title + "</h2>\n\n<p>";
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
        if (frmData.sect_bibliographic_information.fields.fld_version_info_if_applicable_.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_version_info_if_applicable_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_version_info_if_applicable_.value + "<br>\n";
            data['field_677'] = frmData.sect_bibliographic_information.fields.fld_version_info_if_applicable_.value;
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
    console.log(`data: ${JSON.stringify(data)}`);

    // Prepare email content for Library staff
    libOptions.from = frmData.sect_requestor_information.fields.fld_email_address.value;
    libOptions.replyTo = frmData.sect_requestor_information.fields.fld_email_address.value;
    // @TODO Routing varies based on format and if for reserves...
    libOptions.to = 'lib-ux-testing@virginia.edu';
    libOptions.subject = subjPre + ': Purchase Recommendation';
    libOptions.html = adminMsg + biblioInfo + requestorInfo + courseInfo;
    libOptions.text = stripHtml(adminMsg + biblioInfo + requestorInfo + courseInfo);
    promises[0] = mailTransport.sendMail(libOptions);

    // Prepare email confirmation content for patron
    userOptions.to = frmData.sect_requestor_information.fields.fld_email_address.value;
    userOptions.subject = subjPre + ': Purchase Recommendation';
    userOptions.html = patronMsg + biblioInfo + requestorInfo + courseInfo;
    userOptions.text = stripHtml(patronMsg + biblioInfo + requestorInfo + courseInfo);
    promises[1] = mailTransport.sendMail(userOptions);

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
        inputs += "<h2>" + frmData.sect_question_or_comment.title + "</h2>\n\n<p>" + frmData.sect_question_or_comment.fields.fld_enter_your_question_or_comment_regarding_governement_resourc.value + "</p><br>\n";
        data['field_625'] = frmData.sect_question_or_comment.fields.fld_enter_your_question_or_comment_regarding_governement_resourc.value;
    }
    msg = "<p>The question below was submitted through the Government Information Resources Contact Us page:</p><br>\n\n";
    console.log(`data: ${JSON.stringify(data)}`);

    // Prepare email content for Library staff
    // @TODO Routing goes to Govtinfo address in production: govtinfo@groups.mail.virginia.edu
    libOptions.from = frmData.fld_email_address.value;
    libOptions.replyTo = frmData.fld_email_address.value;
    libOptions.to = 'jlk4p@virginia.edu';
    libOptions.subject = 'Reference Referral';
    libOptions.html = msg + inputs;
    libOptions.text = stripHtml(msg + inputs);
    promises[0] = mailTransport.sendMail(libOptions);

    // Prepare email confirmation content for patron
    msg = "<p>Your request (copied below) has been received and will be referred to Government Information Resources.</p><br>\n\n";
    userOptions.from = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.replyTo = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.to = frmData.fld_email_address.value;
    userOptions.subject = 'Your reference referral';
    userOptions.html = msg + inputs;
    userOptions.text = stripHtml(msg + inputs);
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