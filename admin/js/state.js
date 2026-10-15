/**
 * Admin Shared State
 * All mutable global data lives here so every module reads/writes the same references.
 */

var requests = [];
var staff    = [];
var rooms    = [];
var adminEvents = [];

var currentCalendarDate  = new Date();
var selectedRequestToEdit = null;
var currentModalMode     = 'FULL_EDIT'; // FULL_EDIT | PAYMENT_ONLY | VIEW_ONLY | CONFIRMED_EDIT | QUEUE_REVIEW
