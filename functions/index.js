const functions = require('firebase-functions');
const {Storage} = require('@google-cloud/storage');
const storage = new Storage();
const bucket = storage.bucket('uvalib-api.appspot.com'); 
const request = require('request'); // used by requestPN
const requestPN = require('request-promise-native');
const fetch = require('node-fetch');
const stripHtml = require('string-strip-html');
const moment = require('moment');
const headerObj = {'Content-Type': 'application/x-www-form-urlencoded'};

// Environment variables configured for use with sending emails and saving data to LibInsight for forms.
// See https://firebase.google.com/docs/functions/config-env
const emailSecret = functions.config().email.secret;
const emailUrl = 'https://api.library.virginia.edu/mailer/mailer.js';
const purchaseRecommendationDatasetApi = functions.config().libinsighturl.purchaserecommendation;
const governmentInformationDatasetApi = functions.config().libinsighturl.governmentinformation;
const specCollInstructionDatasetApi = functions.config().libinsighturl.speccollinstruction;
const personalCopyReserveDatasetApi = functions.config().libinsighturl.personalcopyreserve;
const researchTutorialRequestDatasetApi = functions.config().libinsighturl.researchtutorial;

// Variables for identifying a problem when a form submission doesn't complete successfully in sending emails or saving data to LibInsight.
let queryString = '';

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

    // Initialize email routing/content.
    let libraryOptions = {
        secret: emailSecret,
        from: '"UVA Library" <no-reply-library@Virginia.EDU>',
        replyTo: '',
        to: '',
        bcc: '',
        subject: '',
        text: '',
        html: '',
        attach_type: 'attach',
        sourceFile: '',
        destFile: ''
    };
    let patronOptions = {
        secret: emailSecret,
        from: '"UVA Library" <no-reply-library@Virginia.EDU>',
        replyTo: '"UVA Library" <NO-REPLY-LIBRARY@Virginia.EDU>',
        to: '',
        bcc: '',
        subject: '',
        text: '',
        html: '',
        attach_type: 'attach',
        sourceFile: '',
        destFile: ''
    };

    // Identify the request type and process...
    const formFields = getFormFields(reqDetails);
    console.log(`${formId}: ${requestId}`);
    if ((formId === 'purchase_requests') || (formId === 'purchase_request_limited_functio')) {
        return processPurchaseRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'class_visits_and_instruction') {
        return processSpecCollInstructionRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'personal_copy_reserve') {
        return processPersonalCopyReserveRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'research_tutorial_request') {
        return processResearchTutorialRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'government_information_contact_u') {
        return processGovernmentInformationRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else {
        return null;
    }

});

function choiceDateTimeToString(choice) {
    let str = '';
    if (choice.preferredDateTime.date !== "") {
        str += "<p><strong>Choice " + choice.nth + "</strong><br>\n";
        str += "Date: " + convDateYMDtoMDY(choice.preferredDateTime.date) + "<br>\n";
        if (choice.preferredDateTime.startTime !== "") {
            str += "Begin time: " + convTime24to12(choice.preferredDateTime.startTime) + "<br>\n";
        }
        if (choice.preferredDateTime.endTime !== "") {
            str += "End time: " + convTime24to12(choice.preferredDateTime.endTime) + "<br>\n";
        }
        str += "</p>\n";
    }
    return str;
}

function convDateYMDtoMDY(date) {
    return moment(date,"YYYY-MM-DD").format("MM-DD-YYYY");
}

function convTime24to12(time) {
    let date = moment().format("YYYY-MM-DD ");
    return moment(date+time,"YYYY-MM-DD HH:mm").format("hh:mm A");
}

async function deleteFirebaseFile(sourceFile) {
    let file = bucket.file('form_file_uploads/'+sourceFile);
    return await file.delete((error,response) => {
        if (error) {
            console.log(`Error deleting storage of ${sourceFile}: `+error.toString());
            return false;
        } else {
            console.log(`File ${sourceFile} deleted: `+response.toString());
            return true;
        }
    });
}

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

function isObjectEmpty(obj) {
    for (var key in obj) {
        if (obj.hasOwnProperty(key)) return false;
    }
    return true;
}

async function processPurchaseRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let adminMsg = subjPre = courseInfo = biblioInfo = requestorInfo = '';
    let patronMsg = "<p>A copy of your purchase recommendation is shown below.</p><br>\n\n";
    let data = { 'field_642': reqId, 'ts_start': submitted };

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
            courseInfo += "\n<h3>" + frmData.sect_course_information.title + "</h3>\n\n<p>";
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
        requestorInfo += "\n<h3>";
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
        biblioInfo += "\n<h3>" + frmData.sect_bibliographic_information.title + "</h3>\n\n<p>";
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
            if ((frmData.fld_format.value === 'Journal Subscription') || (frmData.fld_format.value === 'Other') || (frmData.fld_format.value === 'Other (No print books.)')) {
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

    // Prepare email confirmation content for patron
    userOptions.subject = (frmData.fld_is_this_for_course_reserves_.value && (frmData.fld_is_this_for_course_reserves_.value === "Yes")) ? 'Reserve ' : '';
    userOptions.subject += 'Purchase Recommendation';
    userOptions.to = frmData.sect_requestor_information.fields.fld_email_address.value;
    userOptions.html = patronMsg + biblioInfo + requestorInfo + courseInfo + reqText;
    userOptions.text = stripHtml(patronMsg + biblioInfo + requestorInfo + courseInfo + reqText);

    try {
        return postEmailAndData(reqId, libOptions, userOptions, purchaseRecommendationDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processSpecCollInstructionRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let contactInfo = courseInfo = sessionInfo = scheduleInfo = commentInfo = '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    let adminMsg = "<p><strong>* This email may contain an attachment. It is recommended that you scan the attachment to make sure it does not contain a virus.</strong></p>\n\n";
    let patronMsg = "<p>Thank you for contacting the Small Special Collection Library. This email contains a copy of the information you submitted.</p><br>\n\n";
    patronMsg += "<p>Please contact Krystal Appiah (ka7uz@virginia.edu / 434-243-8194) or Heather Riser (mhm8m@virginia.edu / 434-924-4966) if you have questions regarding this request.</p><br>\n\n";
    let data = { 'field_874': reqId, 'ts_start': submitted };

    // Create contact info output content and set appropriate LibInsight fields.
    contactInfo += "\n<h3>"+frmData.sect_your_contact_information.title+"</h3>\n\n<p>";
    if (frmData.sect_your_contact_information.fields.fld_name.value) {
        contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_name.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_name.value + "<br>\n";
        data['field_877'] = frmData.sect_your_contact_information.fields.fld_name.value;
    }
    if (frmData.sect_your_contact_information.fields.fld_email_address.value) {
        contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_email_address.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_email_address.value + "<br>\n";
        data['field_878'] = frmData.sect_your_contact_information.fields.fld_email_address.value;
    }
    if (frmData.sect_your_contact_information.fields.fld_phone_number.value) {
        contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_phone_number.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_phone_number.value + "<br>\n";
        data['field_879'] = frmData.sect_your_contact_information.fields.fld_phone_number.value;
    }
    if (frmData.sect_your_contact_information.fields.fld_department.value) {
        contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_department.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_department.value + "<br>\n";
        data['field_880'] = frmData.sect_your_contact_information.fields.fld_department.value;
    }
    if (frmData.sect_your_contact_information.fields.fld_uva_affiliation.value) {
        contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_uva_affiliation.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_uva_affiliation.value + "<br>\n";
        data['field_881'] = frmData.sect_your_contact_information.fields.fld_uva_affiliation.value;
        if (frmData.sect_your_contact_information.fields.fld_uva_affiliation.value === "Unaffiliated" 
            && frmData.sect_your_contact_information.fields.fld_please_list_your_group_or_institution.value) {
            contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_please_list_your_group_or_institution.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_please_list_your_group_or_institution.value + "<br>\n";
            data['field_882'] = frmData.sect_your_contact_information.fields.fld_please_list_your_group_or_institution.value;
        }
    }
    contactInfo += "</p><br>\n";
    // Create course info output content and set appropriate LibInsight fields.
    if ((frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.course)
        || (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.section) 
        || (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.title) 
        || (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.enrollment) 
        || (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value && (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value.fids.length > 0))) {
        courseInfo += "\n<h3>"+frmData.sect_course_information_if_applicable_.title+"</h3>\n\n<p>";
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.term) {
            courseInfo += "<strong>Term</strong><br>\n" + frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.term + "<br>\n";
            data['field_883'] = frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.term;
        }
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.course) {
            courseInfo += "<strong>Course</strong><br>\n" + frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.course + "<br>\n";
            data['field_884'] = frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.course;
        }
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.section) {
            courseInfo += "<strong>Course section</strong><br>\n" + frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.section + "<br>\n";
            data['field_885'] = frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.section;
        }
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.title) {
            courseInfo += "<strong>Course title</strong><br>\n" + frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.title + "<br>\n";
            data['field_886'] = frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.title;
        }
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.enrollment) {
            courseInfo += "<strong>Enrollment</strong><br>\n" + frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.enrollment + "<br>\n";
            data['field_887'] = frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.enrollment;
        }
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value && (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value.fids.length > 0)) {
            const firebaseFilename = (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value.fids.length > 0) ? frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value.fids[0] : '';
            if (firebaseFilename !== "") {
                libOptions.attach_type = userOptions.attach_type = (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.email_type) ? frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.email_type : 'link';
                libOptions.sourceFile = userOptions.sourceFile = firebaseFilename;
                libOptions.destFile = userOptions.destFile = firebaseFilename.substring(firebaseFilename.indexOf('_')+1);
                courseInfo += "<strong>" + frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.label + " file name</strong><br>\n" + libOptions.destFile + "<br>\n";
                data['field_941'] = firebaseFilename;
            }
        }
        courseInfo += "</p><br>\n";
    }
    // Create session info output content and set appropriate LibInsight fields.
    sessionInfo += "\n<h3>"+frmData.sect_session_information.title+"</h3>\n\n<p>";
    if (!isObjectEmpty(frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.value)) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.label + "</strong><br>\n";
        sessionInfo += "<ul>";
        for (let key in frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.value) {
            sessionInfo += "<li>" + frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.value[key] + "</li>\n";
        }
        sessionInfo += "</ul><br>\n";
        data['field_888'] = Object.keys(frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.value).join(', ');
        if (frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.value.hasOwnProperty("Course related instruction")) {
            sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_for_course_related_instruction.label + "</strong><br>\n" + frmData.sect_session_information.fields.fld_for_course_related_instruction.value + "<br>\n";
            data['field_889'] = frmData.sect_session_information.fields.fld_for_course_related_instruction.value;
        }
    }
    if (frmData.sect_session_information.fields.fld_number_of_participants.value) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_number_of_participants.label + "</strong><br>\n" + frmData.sect_session_information.fields.fld_number_of_participants.value + "<br>\n";
        data['field_890'] = frmData.sect_session_information.fields.fld_number_of_participants.value;
    }
    if (!isObjectEmpty(frmData.sect_session_information.fields.fld_level_of_participants.value)) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_level_of_participants.label + "</strong><br>\n";
        sessionInfo += "<ul>";
        for (let key in frmData.sect_session_information.fields.fld_level_of_participants.value) {
            sessionInfo += "<li>" + frmData.sect_session_information.fields.fld_level_of_participants.value[key] + "</li>\n";
        }
        sessionInfo += "</ul><br>\n";
        data['field_891'] = Object.keys(frmData.sect_session_information.fields.fld_level_of_participants.value).join(', ');
        if (frmData.sect_session_information.fields.fld_level_of_participants.value.hasOwnProperty("Unaffiliated")) {
            if (frmData.sect_session_information.fields.fld_name_of_group_or_institution_if_applicable_.value) {
                sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_name_of_group_or_institution_if_applicable_.label + "</strong><br>\n" + frmData.sect_session_information.fields.fld_name_of_group_or_institution_if_applicable_.value + "<br>\n";
                data['field_892'] = frmData.sect_session_information.fields.fld_name_of_group_or_institution_if_applicable_.value;
            }
        }
    }
    if (frmData.sect_session_information.fields.fld_explanation_of_instructional_needs.value) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_explanation_of_instructional_needs.label + "</strong><br>\n" + frmData.sect_session_information.fields.fld_explanation_of_instructional_needs.value + "<br>\n";
        data['field_893'] = frmData.sect_session_information.fields.fld_explanation_of_instructional_needs.value;
    }
    if (frmData.sect_session_information.fields.fld_goals_for_session.value) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_goals_for_session.label + "</strong><br>\n" + frmData.sect_session_information.fields.fld_goals_for_session.value + "<br>\n";
        data['field_894'] = frmData.sect_session_information.fields.fld_goals_for_session.value;
    }
    if (frmData.sect_session_information.fields.fld_are_there_specific_materials_you_would_like_to_cover_.value) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_are_there_specific_materials_you_would_like_to_cover_.label + ":</strong><br>\n";
        sessionInfo += (frmData.sect_session_information.fields.fld_are_there_specific_materials_you_would_like_to_cover_.value === 1) ? 'Yes' : 'No';
        sessionInfo += "<br>\n";
        data['field_895'] = (frmData.sect_session_information.fields.fld_are_there_specific_materials_you_would_like_to_cover_.value === 1) ? 'Yes' : 'No';
    }
    if (frmData.sect_session_information.fields.fld_do_you_need_audiovisual_support_for_your_class_.value) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_do_you_need_audiovisual_support_for_your_class_.label + ":</strong><br>\n";
        sessionInfo += (frmData.sect_session_information.fields.fld_do_you_need_audiovisual_support_for_your_class_.value === 1) ? 'Yes' : 'No';
        sessionInfo += "<br>\n";
        data['field_896'] = (frmData.sect_session_information.fields.fld_do_you_need_audiovisual_support_for_your_class_.value === 1) ? 'Yes' : 'No';
    }
    sessionInfo += "</p><br>\n";
    // Create session info output content and set appropriate LibInsight fields.
    scheduleInfo += "\n<h3>"+frmData.sect_scheduling_information.title+"</h3>\n\n";
    if (frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data && frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data.length > 0) {
        let numSessions = 0;
        for (let i=0; i < frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data.length; i++) {
            if (frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data[i].show) numSessions++;
        }
        scheduleInfo += "<p><strong>Sessions requested</strong><br>\n" + numSessions + "<br>\n</p>";
        data['field_897'] = numSessions;
        for (let i=0; i < frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data.length; i++) {
            const session = frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data[i];
            if (session.show) {
                const sessionText = sessionLengthAndChoicesToString(session);
                scheduleInfo += sessionText + "<hr>";
                if (session.nth === 1) {
                    data['field_898'] = stripHtml(sessionText);
                } else if (session.nth === 2) {
                    data['field_899'] = stripHtml(sessionText);
                } else if (session.nth === 3) {
                    data['field_900'] = stripHtml(sessionText);
                } else if (session.nth === 4) {
                    data['field_901'] = stripHtml(sessionText);
                } else if (session.nth === 5) {
                    data['field_902'] = stripHtml(sessionText);
                } else {
                    data['field_903'] = stripHtml(sessionText);
                }
            }
        }
    }
    scheduleInfo += "<br>\n";
    // Create comment info output if there is any.
    if (frmData.fld_comments.value) {
        commentInfo += "<br>\n";
        commentInfo += "<strong>" + frmData.fld_comments.label + "</strong><br>\n" + frmData.fld_comments.value + "<br>\n";
        data['field_904'] = frmData.fld_comments.value;
    }

    libOptions.from = frmData.sect_your_contact_information.fields.fld_email_address.value;
    libOptions.replyTo = frmData.sect_your_contact_information.fields.fld_email_address.value;
    libOptions.to = 'mhm8m@virginia.edu,ka7uz@virginia.edu';
    libOptions.subject = 'Small Special Collections Instruction Request: '+frmData.sect_your_contact_information.fields.fld_name.value;
    libOptions.html = adminMsg + patronMsg + contactInfo + courseInfo + sessionInfo + scheduleInfo + commentInfo + reqText;
    libOptions.text = stripHtml(adminMsg + patronMsg + contactInfo + courseInfo + sessionInfo + scheduleInfo + commentInfo + reqText);
    console.log(libOptions);

    // Prepare email confirmation content for patron
    userOptions.subject = 'Small Special Collections Instruction Request';
    userOptions.to = frmData.sect_your_contact_information.fields.fld_email_address.value;
    userOptions.html = patronMsg + contactInfo + courseInfo + sessionInfo + scheduleInfo + commentInfo + reqText;
    userOptions.text = stripHtml(patronMsg + contactInfo + courseInfo + sessionInfo + scheduleInfo + commentInfo + reqText);
    
    try {
        return postEmailAndData(reqId, libOptions, userOptions, specCollInstructionDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processPersonalCopyReserveRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let instructorInfo = courseInfo = materialsInfo = msg = instructorName = instructorEmail = courseNum = materials = itemDetails = '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    let data = { 'field_967': reqId, 'ts_start': submitted, 'ts_end': submitted };
    
    // Prepare email message body and LibInsight data parameters
    instructorInfo += "\n<h3>"+frmData.sect_instructor_information_.title+"</h3>\n\n<p>";
    if (frmData.sect_instructor_information_.fields.fld_uva_computing_id.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_uva_computing_id.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_uva_computing_id.value + "<br>\n";
        data['field_948'] = frmData.sect_instructor_information_.fields.fld_uva_computing_id.value;
    }
    if (frmData.sect_instructor_information_.fields.fld_name.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_name.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_name.value + "<br>\n";
        data['field_946'] = frmData.sect_instructor_information_.fields.fld_name.value;
        instructorName = frmData.sect_instructor_information_.fields.fld_name.value;
    }
    if (frmData.sect_instructor_information_.fields.fld_email_address.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_email_address.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_email_address.value + "<br>\n";
        data['field_947'] = frmData.sect_instructor_information_.fields.fld_email_address.value;
        instructorEmail = frmData.sect_instructor_information_.fields.fld_email_address.value;
    }
    if (frmData.sect_instructor_information_.fields.fld_are_you_making_this_request_on_behalf_of_the_instructor.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_are_you_making_this_request_on_behalf_of_the_instructor.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_are_you_making_this_request_on_behalf_of_the_instructor.value + "<br>\n";
        data['field_944'] = frmData.sect_instructor_information_.fields.fld_are_you_making_this_request_on_behalf_of_the_instructor.value;
        if (frmData.sect_instructor_information_.fields.fld_are_you_making_this_request_on_behalf_of_the_instructor.value === 'Yes') {
            if (frmData.sect_instructor_information_.fields.fld_instructor_name.value) {
                instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_instructor_name.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_instructor_name.value + "<br>\n";
                data['field_949'] = frmData.sect_instructor_information_.fields.fld_instructor_name.value;
                instructorName = frmData.sect_instructor_information_.fields.fld_instructor_name.value;
            }
            if (frmData.sect_instructor_information_.fields.fld_instructor_email_address.value) {
                instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_instructor_email_address.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_instructor_email_address.value + "<br>\n";
                data['field_950'] = frmData.sect_instructor_information_.fields.fld_instructor_email_address.value;
                instructorEmail = frmData.sect_instructor_information_.fields.fld_instructor_email_address.value;
            }
        }
    }
    if (frmData.sect_instructor_information_.fields.fld_phone_number_.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_phone_number_.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_phone_number_.value + "<br>\n";
        data['field_951'] = frmData.sect_instructor_information_.fields.fld_phone_number_.value;
    }
    if (frmData.sect_instructor_information_.fields.fld_university_department_or_school.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_university_department_or_school.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_university_department_or_school.value + "<br>\n";
        data['field_952'] = frmData.sect_instructor_information_.fields.fld_university_department_or_school.value;
        if (frmData.sect_instructor_information_.fields.fld_university_department_or_school.value === 'Other...') {
            instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_other_department.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_other_department.value + "<br>\n";
            data['field_953'] = frmData.sect_instructor_information_.fields.fld_other_department.value;
        }
    }
    if (frmData.sect_instructor_information_.fields.fld_messenger_mail_or_leo_delivery_address.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_messenger_mail_or_leo_delivery_address.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_messenger_mail_or_leo_delivery_address.value + "<br>\n";
        data['field_954'] = frmData.sect_instructor_information_.fields.fld_messenger_mail_or_leo_delivery_address.value;
    }
    instructorInfo += "</p><br>\n";

    courseInfo += "\n<h3>"+frmData.sect_course_information.title+"</h3>\n\n<p>";
    if (frmData.sect_course_information.fields.fld_course_section_selector.value) {
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.term) {
            courseInfo += "<strong>Term:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.term + "<br>\n";
            data['field_955'] = frmData.sect_course_information.fields.fld_course_section_selector.value.term;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.course) {
            courseInfo += "<strong>Course:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.course + "<br>\n";
            data['field_956'] = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
            courseNum = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.section) {
            courseInfo += "<strong>Section:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.section + "<br>\n";
            data['field_957'] = frmData.sect_course_information.fields.fld_course_section_selector.value.section;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse) {
            courseInfo += "<strong>Alternate course:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse + "<br>\n";
            data['field_958'] = frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.altSection) {
            courseInfo += "<strong>Alternate course section:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.altSection + "<br>\n";
            data['field_959'] = frmData.sect_course_information.fields.fld_course_section_selector.value.altSection;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.title) {
            courseInfo += "<strong>Title:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.title + "<br>\n";
            data['field_960'] = frmData.sect_course_information.fields.fld_course_section_selector.value.title;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment) {
            courseInfo += "<strong>Enrollment:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment + "<br>\n";
            data['field_961'] = frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment;
        }
    }
    if (frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value) {
        courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.label + ":</strong> " + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value + "<br>\n";
        data['field_962'] = frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value;
    }
    courseInfo += "</p><br>\n";

    materialsInfo += "\n<h3>"+frmData.sect_materials_for_reserve.title+"</h3>\n\n<p>";
    materialsInfo += "\n<strong>Personal copies will be assigned a 3 hour loan period.</strong><br><br>\n\n";
    if (frmData.sect_materials_for_reserve.fields.fld_personal_items_consist_of.value) {
        materialsInfo += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_personal_items_consist_of.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_personal_items_consist_of.value + "<br><br>\n\n";
        data['field_963'] = frmData.sect_materials_for_reserve.fields.fld_personal_items_consist_of.value;
        materials = frmData.sect_materials_for_reserve.fields.fld_personal_items_consist_of.value;
    }
    if (frmData.sect_materials_for_reserve.fields.fld_item_1_title.value) {
        itemDetails = '';
        if (materials === 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_1_format_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_1_format_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_1_format_media.value + "<br>\n";
            }
        }
        if (materials === 'Print materials and Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_1_format_print_and_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_1_format_print_and_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_1_format_print_and_media.value + "<br>\n";
            }
        }
        if (materials !== 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_1_author.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_1_author.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_1_author.value + "<br>\n";
            }
        }
        itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_1_title.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_1_title.value + "<br>\n";
        materialsInfo += itemDetails;
        data['field_964'] = stripHtml(itemDetails);
    }
    if (frmData.sect_materials_for_reserve.fields.fld_item_2_title.value) {
        itemDetails = '<hr>';
        if (materials === 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_2_format_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_2_format_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_2_format_media.value + "<br>\n";
            }
        }
        if (materials === 'Print materials and Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_2_format_print_and_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_2_format_print_and_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_2_format_print_and_media.value + "<br>\n";
            }
        }
        if (materials !== 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_2_author.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_2_author.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_2_author.value + "<br>\n";
            }
        }
        itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_2_title.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_2_title.value + "<br>\n";
        materialsInfo += itemDetails;
        data['field_965'] = stripHtml(itemDetails);
    }
    if (frmData.sect_materials_for_reserve.fields.fld_item_3_title.value) {
        itemDetails = '<hr>';
        if (materials === 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_3_format_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_3_format_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_3_format_media.value + "<br>\n";
            }
        }
        if (materials === 'Print materials and Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_3_format_print_and_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_3_format_print_and_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_3_format_print_and_media.value + "<br>\n";
            }
        }
        if (materials !== 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_3_author.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_3_author.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_3_author.value + "<br>\n";
            }
        }
        itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_3_title.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_3_title.value + "<br>\n";
        materialsInfo += itemDetails;
        data['field_966'] = stripHtml(itemDetails);
    }
    materialsInfo += "</p><br>\n";

    // Prepare email content for Library staff    
    libOptions.from = instructorEmail;
    libOptions.replyTo = instructorEmail;
    libOptions.to = 'lib-reserves@virginia.edu';
    libOptions.subject = 'Personal Copy - ' + instructorName + ' ' + courseNum;
    if (materials === 'Media') {
        msg = "<p>RMC copy to handle media content for this personal copy request.</p><br>\n\n";
    } else {
        msg = '';
    }
    libOptions.html = msg + instructorInfo + courseInfo + materialsInfo + reqText;
    libOptions.text = stripHtml(msg + instructorInfo + courseInfo + materialsInfo + reqText);

    // Prepare second email content for Library staff. NOTE: Service Desk generates confirmation to patron.
    // This email only needs to be sent to Reserves if person has selected print materials and media requiring second ticket created.
    msg = "<p>RMC copy generated to handle media content for this personal copy request.</p><br>\n\n";
    userOptions.from = instructorEmail;
    userOptions.replyTo = instructorEmail;
    if (materials === 'Print materials and Media') {
        userOptions.to = 'lib-reserves@virginia.edu';
    } else {
        // send second unneeded email here so that it doesn't generate extra ticket in Service Desk;
        // (form workflow assumes 2 emails generated for each submission: library staff and other is confirmation) 
        userOptions.to = 'no-reply-library@virginia.edu';
    }
    userOptions.subject = 'Personal Copy - ' + instructorName + ' ' + courseNum;
    userOptions.html = msg + instructorInfo + courseInfo + materialsInfo + reqText;
    userOptions.text = stripHtml(msg + instructorInfo + courseInfo + materialsInfo + reqText);
    
    try {
        return postEmailAndData(reqId, libOptions, userOptions, personalCopyReserveDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processResearchTutorialRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let requestorInfo = courseInfo = dateInfo = projInfo = requestorName = requestorEmail = msg = '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    let data = { 'field_1003': reqId, 'ts_start': submitted, 'ts_end': submitted };
    
    // Prepare email message body and LibInsight data parameters
    requestorInfo += "\n<h3>"+frmData.sect_requestor_information.title+"</h3>\n\n<p>";
    if (frmData.sect_requestor_information.fields.fld_uva_computing_id.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_uva_computing_id.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_uva_computing_id.value + "<br>\n";
        data['field_985'] = frmData.sect_requestor_information.fields.fld_uva_computing_id.value;
    }
    if (frmData.sect_requestor_information.fields.fld_name.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_name.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_name.value + "<br>\n";
        data['field_986'] = frmData.sect_requestor_information.fields.fld_name.value;
        requestorName = frmData.sect_requestor_information.fields.fld_name.value;
    }
    if (frmData.sect_requestor_information.fields.fld_email_address.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_email_address.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_email_address.value + "<br>\n";
        data['field_987'] = frmData.sect_requestor_information.fields.fld_email_address.value;
        requestorEmail = frmData.sect_requestor_information.fields.fld_email_address.value;
    }
    if (frmData.sect_requestor_information.fields.fld_phone_number.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_phone_number.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_phone_number.value + "<br>\n";
        data['field_988'] = frmData.sect_requestor_information.fields.fld_phone_number.value;
    }
    if (frmData.sect_requestor_information.fields.fld_university_affiliation.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_university_affiliation.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_university_affiliation.value + "<br>\n";
        data['field_989'] = frmData.sect_requestor_information.fields.fld_university_affiliation.value;
    }
    if (frmData.sect_requestor_information.fields.fld_university_department_or_school.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_university_department_or_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_university_department_or_school.value + "<br>\n";
        data['field_990'] = frmData.sect_requestor_information.fields.fld_university_department_or_school.value;
        if (frmData.sect_requestor_information.fields.fld_university_department_or_school.value === 'Other...') {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_other_department_or_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_other_department_or_school.value + "<br>\n";
            data['field_991'] = frmData.sect_requestor_information.fields.fld_other_department_or_school.value;
        }
    }
    requestorInfo += "</p><br>\n";

    courseInfo += "\n<h3>"+frmData.sect_course_information.title+"</h3>\n\n<p>";
    if (frmData.sect_course_information.fields.fld_course_section_selector.value) {
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.term) {
            courseInfo += "<strong>Term:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.term + "<br>\n";
            data['field_992'] = frmData.sect_course_information.fields.fld_course_section_selector.value.term;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.course) {
            courseInfo += "<strong>Course:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.course + "<br>\n";
            data['field_993'] = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
            courseNum = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.section) {
            courseInfo += "<strong>Section:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.section + "<br>\n";
            data['field_994'] = frmData.sect_course_information.fields.fld_course_section_selector.value.section;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.title) {
            courseInfo += "<strong>Title:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.title + "<br>\n";
            data['field_995'] = frmData.sect_course_information.fields.fld_course_section_selector.value.title;
        }
    }
    courseInfo += "</p><br>\n";
    dateInfo += "\n<h3>"+frmData.sect_tutorial_date.title+"</h3><p>\n\n";
    if (frmData.sect_tutorial_date.fields.fld_preferred_dates.value.sessionDateTime && frmData.sect_tutorial_date.fields.fld_preferred_dates.value.sessionDateTime.length > 0) {
        for (let i=0; i < frmData.sect_tutorial_date.fields.fld_preferred_dates.value.sessionDateTime.length; i++) {
            const choice = frmData.sect_tutorial_date.fields.fld_preferred_dates.value.sessionDateTime[i];
            let choiceStr = choiceDateTimeToString(choice);
            dateInfo += choiceStr;
            if (choice.nth === 1) {
                data['field_996'] = stripHtml(choiceStr);
            } else {
                data['field_999'] = stripHtml(choiceStr);
            }
        }
    }
    dateInfo += "</p><br>\n";
    projInfo += "\n<h3>"+frmData.sect_project_research_topic.title+"</h3><p>\n\n";
    if (frmData.sect_project_research_topic.fields.fld_please_briefly_describe_your_project_or_research_topic.value) {
        projInfo += "<strong>" + frmData.sect_project_research_topic.fields.fld_please_briefly_describe_your_project_or_research_topic.label + ":</strong><br>\n" + frmData.sect_project_research_topic.fields.fld_please_briefly_describe_your_project_or_research_topic.value + "<br>\n";
        data['field_1002'] = frmData.sect_project_research_topic.fields.fld_please_briefly_describe_your_project_or_research_topic.value;
    }
    projInfo += "</p><br>\n";
    msg = "<p>The request below was submitted through the Research Tutorial Request Form:</p><br>\n\n";

    // Prepare email content for Library staff
    libOptions.from = '"'+requestorName+'" <'+requestorEmail+'>';
    libOptions.replyTo = requestorEmail;
    libOptions.to = 'kw6m@virginia.edu';
    libOptions.subject = 'Research tutorial requested';
    libOptions.html = msg + requestorInfo + courseInfo + dateInfo + projInfo + reqText;
    libOptions.text = stripHtml(msg + requestorInfo + courseInfo + dateInfo + projInfo + reqText);

    // Prepare email confirmation content for patron
    msg = "<p>Your request will be forwarded to the library staff member most familiar with your area of research. Staff will ";
    msg+= "be in touch with you to arrange your consultation. Below is a copy of what you submitted.</p><br>\n\n";
    userOptions.from = '"Keith Weimer" <kw6m@virginia.edu>';
    userOptions.replyTo = '"Keith Weimer" <kw6m@virginia.edu>';
    userOptions.to = requestorEmail;
    userOptions.subject = 'Your research tutorial request';
    userOptions.html = msg + requestorInfo + courseInfo + dateInfo + projInfo + reqText;
    userOptions.text = stripHtml(msg + requestorInfo + courseInfo + dateInfo + projInfo + reqText);
    
    try {
        return postEmailAndData(reqId, libOptions, userOptions, researchTutorialRequestDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processGovernmentInformationRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let inputs = msg = '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    let data = { 'field_619': reqId, 'ts_start': submitted };
    
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
        inputs += "\n<h3>" + frmData.sect_question_or_comment.title + "</h3>\n\n<p>" + frmData.sect_question_or_comment.fields.fld_enter_your_question_or_comment_regarding_governement_resourc.value + "</p><br>\n";
        data['field_625'] = frmData.sect_question_or_comment.fields.fld_enter_your_question_or_comment_regarding_governement_resourc.value;
    }
    msg = "<p>The question below was submitted through the Government Information Resources Contact Us page:</p><br>\n\n";

    // Prepare email content for Library staff
    libOptions.from = frmData.fld_email_address.value;
    libOptions.replyTo = frmData.fld_email_address.value;
    // @TODO Routing goes to Govtinfo address in production: govtinfo@groups.mail.virginia.edu
    libOptions.to = 'jlk4p@virginia.edu';
    libOptions.subject = 'Reference Referral';
    libOptions.html = msg + inputs + reqText;
    libOptions.text = stripHtml(msg + inputs + reqText);

    // Prepare email confirmation content for patron
    msg = "<p>Your request (copied below) has been received and will be referred to Government Information Resources.</p><br>\n\n";
    userOptions.from = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.replyTo = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.to = frmData.fld_email_address.value;
    userOptions.subject = 'Your reference referral';
    userOptions.html = msg + inputs + reqText;
    userOptions.text = stripHtml(msg + inputs + reqText);
    
    try {
        return postEmailAndData(reqId, libOptions, userOptions, governmentInformationDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

function requestPostEmailAndData(reqId, requestEmailOptions, confirmEmailOptions, apiUrl, formData) {
    console.log('entered postEmailAndData function');
    console.log(requestEmailOptions);
    requestPN({method: 'POST', uri: emailUrl, form: requestEmailOptions})
    .then(body => {
        console.log('library request email sent to emailUrl');
        if (body && (body.search('Status: 201 Created') !== -1)) {
            console.log(`Library request notification sent for ${reqId}: `+body);
            return requestPN({method: 'POST', uri: emailUrl, form: confirmEmailOptions});
        } else {
            console.log(`Library request notification failed for ${reqId}: `+body);
            throw new Error(`Library request notification failed for ${reqId}: `+body);
        }
    })
    .then(body => {
        console.log('library confirm email sent to emailUrl');
        if(body && (body.search('Status: 201 Created') !== -1)) {
            console.log(`Patron confirmation notification sent for ${reqId}: `+body);
            return requestPN({method: 'POST', uri: apiUrl, form: formData});
        } else {
            console.log(`Patron confirmation notification failed for ${reqId}: `+body);
            throw new Error(`Patron confirmation notification failed for ${reqId}: `+body);
        }
    })
    .then(body => {
        console.log('returned from confirm email and should write to LibInsight');
        if (body) {
            const result = JSON.parse(body);
            if (result.response) {
                console.log(`LibInsight data saved for ${reqId}: `+body);
            }
            // Emails successfully sent, delete uploaded file if attached to email.
            if (requestEmailOptions.sourceFile !== "" && requestEmailOptions.attach_type === 'attach') {
                try {
                    deleteFirebaseFile(requestEmailOptions.sourceFile);
                }
                catch (error) {
                    return error;
                }
            }
            return result.response;
        } else {
            console.log(`Bad response from ${apiUrl}: `+body);
            throw new Error(`Bad response from ${apiUrl}: `+body);
        }
    })
    .catch(error => function(error) {
        console.log(`Error for request ${reqId}: `);
        console.log(error);
        return error;
    });
}

function sessionLengthAndChoicesToString(data) {
    let str = '';
    str += "<h4>Session " + data.nth + "</h4>\n\n";
    if (data.session.sessionLength !== "") {
        str += "<p><strong>Session length (minutes)</strong><br>\n" + data.session.sessionLength + "</p>\n\n";
    }
    for (let j=0; j < data.session.sessionDateTime.length; j++) {
        str += choiceDateTimeToString(data.session.sessionDateTime[j]);
    }
    return str;
}

function paramsString(obj) {
    return Object.keys(obj).map(key => key + '=' + encodeURIComponent(obj[key])).join('&');
}

function postEmailAndData(reqId, requestEmailOptions, confirmEmailOptions, apiUrl, formData) {
    console.log('entered postEmailAndData function');
    console.log(requestEmailOptions);
    queryString = paramsString(requestEmailOptions);
    console.log(queryString);
    fetch(emailUrl, { method: 'POST', body: queryString, headers: headerObj })
    .then(res => { console.log(res); return res.text() })
    .then(body => {
        console.log('library request email sent to emailUrl');
        if (body && (body.search('Status: 201 Created') !== -1)) {
            console.log(`Library request notification sent for ${reqId}: `+body);
            queryString = paramsString(confirmEmailOptions);
            return fetch(emailUrl, { method: 'POST', body: queryString, headers: headerObj });
        } else {
            console.log(`Library request notification failed for ${reqId}: `+body);
            throw new Error(`Library request notification failed for ${reqId}: `+body);
        }
    })
    .then(res => res.text())
    .then(body => {
        console.log('library confirm email sent to emailUrl');
        if(body && (body.search('Status: 201 Created') !== -1)) {
            console.log(`Patron confirmation notification sent for ${reqId}: `+body);
            queryString = paramsString(formData);
            return fetch(apiUrl, { method: 'POST', body: queryString, headers: headerObj });
        } else {
            console.log(`Patron confirmation notification failed for ${reqId}: `+body);
            throw new Error(`Patron confirmation notification failed for ${reqId}: `+body);
        }
    })
    .then(res => res.text())
    .then(body => {
        console.log('returned from confirm email and should write to LibInsight');
        if (body) {
            const result = JSON.parse(body);
            if (result.response) {
                console.log(`LibInsight data saved for ${reqId}: `+body);
            }
            // Emails successfully sent, delete uploaded file if attached to email.
            if (requestEmailOptions.sourceFile !== "" && requestEmailOptions.attach_type === 'attach') {
                try {
                    deleteFirebaseFile(requestEmailOptions.sourceFile);
                }
                catch (error) {
                    return error;
                }
            }
            return result.response;
        } else {
            console.log(`Bad response from ${apiUrl}: `+body);
            throw new Error(`Bad response from ${apiUrl}: `+body);
        }
    })
    .catch(error => function(error) {
        console.log(`Error for request ${reqId}: `);
        console.log(error);
        return error;
    });
}