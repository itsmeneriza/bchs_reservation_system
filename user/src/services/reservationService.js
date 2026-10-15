/**
 * reservation Service
 * Handles all reservation-related operations
 */

import { state } from '../core/state.js';
import { dataService } from './dataService.js';
import { requestService } from './requestService.js';
import { getLocalISODate } from '../utils/dateUtils.js';

export async function loadData() {
    try {
        const success = await dataService.loadAllData();
        
        if (success) {
            state.rooms = dataService.getRooms();
            state.reservations = dataService.getReservations();
        }
        
        return success;
    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load data. Please ensure data files exist.');
        return false;
    }
}

export async function saveReservationRequest(request) {
    // Final check for conflicts (including admin blocks) before saving
    const conflict = findConflict(request.roomId, request.date, request.startTime, request.endTime);
    if (conflict) return false;

    // Save via requestService → POST /api/requests → requests.json
    try {
        const saved = await requestService.saveRequest(request);
        if (saved) {
            // Add to local state so calendar updates immediately without reload
            state.reservations.push(saved);
        }
        return !!saved;
    } catch (e) {
        if (e.status === 429) throw e;
        return false;
    }
}

/**
 * Get all active reservations for a specific date and room.
 * Includes manual 'global' blocks that close all rooms.
 */
export function getReservationsForDate(roomId, dateStr) {
    return state.reservations.filter(b => {
        // Exclude cancelled/refused — these should never show on the calendar or time slots
        const isCancelled = ['cancelled', 'refused', 'rejected'].includes(b.status);
        if (isCancelled) return false;

        // Status must be approved, pending, or blocked
        const isValidStatus = ['approved', 'accepted', 'pending', 'blocked'].includes(b.status);
        if (!isValidStatus) return false;

        const isGlobalBlock = (b.roomId === 'global' && b.status === 'blocked');
        const isDirectMatch = (b.roomId === roomId && b.date === dateStr);
        return (isGlobalBlock && b.date === dateStr) || (isDirectMatch && b.date === dateStr);
    });
}

export function getReservationDensity(roomId, day, month, year) {
    const dateStr = getLocalISODate(new Date(year, month, day));
    const dayreservations = getReservationsForDate(roomId, dateStr);
    
    // If there's a global block or a full-day manual block for this room, mark as full
    if (dayreservations.some(b => b.status === 'blocked' && b.isFullDayBlock)) return 'full';
    
    if (dayreservations.length === 0) return 'none';
    
    let totalBookedHours = 0;
    dayreservations.forEach(reservation => {
        const start = parseInt(reservation.startTime.split(':')[0], 10);
        const end = parseInt(reservation.endTime.split(':')[0], 10);
        totalBookedHours += (end - start);
    });
    
    const totalAvailableHours = 11; // 7 AM - 6 PM
    const bookedPercentage = (totalBookedHours / totalAvailableHours) * 100;
    
    if (bookedPercentage >= 70) return 'full';
    if (bookedPercentage >= 40) return 'busy';
    return 'light';
}

export function isTimeSlotBooked(roomId, dateStr, slotTime, excludeId = null) {
    const [startStr, endStr] = slotTime.split('-');
    const slotStart = parseInt(startStr.split(':')[0], 10);
    const slotEnd = parseInt(endStr.split(':')[0], 10);
    
    const reservations = getReservationsForDate(roomId, dateStr);
    
    return reservations.some(reservation => {
        if (excludeId && reservation.id === excludeId) return false;
        // If the whole day is blocked, every slot is booked
        if (reservation.status === 'blocked' && reservation.isFullDayBlock) return true;

        const reservationStart = parseInt(reservation.startTime.split(':')[0], 10);
        const reservationEnd = parseInt(reservation.endTime.split(':')[0], 10);
        // Overlap Check
        return (slotStart < reservationEnd && slotEnd > reservationStart);
    });
}

export function getAvailableSlots(roomId, dateStr) {
    const allSlots = [
        '07:00-08:00', '08:00-09:00', '09:00-10:00', '10:00-11:00',
        '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00',
        '15:00-16:00', '16:00-17:00', '17:00-18:00'
    ];
    
    return allSlots.filter(
        slot => !isTimeSlotBooked(roomId, dateStr, slot)
    );
}

export function getBookedSlots(roomId, dateStr, excludeId = null) {
    const allSlots = [
        '07:00-08:00', '08:00-09:00', '09:00-10:00', '10:00-11:00',
        '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00',
        '15:00-16:00', '16:00-17:00', '17:00-18:00'
    ];
    
    return allSlots.filter(
        slot => isTimeSlotBooked(roomId, dateStr, slot, excludeId)
    );
}

export function findConflict(roomId, date, startTime, endTime, excludeId = null) {
    const relevant = getReservationsForDate(roomId, date);
    return relevant.find(reservation => {
        if (excludeId && reservation.id === excludeId) return false;
        // Full day blocks conflict with everything
        if (reservation.status === 'blocked' && reservation.isFullDayBlock) return true;
        
        return reservation.startTime < endTime &&
               reservation.endTime > startTime;
    });
}