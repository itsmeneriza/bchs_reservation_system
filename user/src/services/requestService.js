/**
 * Request Service
 * Handles reservation requests via the server's Supabase-backed API.
 */

export class RequestService {
    constructor() {
        this.API_BASE = '/api';
    }

    async saveRequest(request) {
        const newRequest = {
            ...request,
            id: request.id || this.generateId(),
            status: request.status || 'pending',
            submittedAt: request.submittedAt || new Date().toISOString()
        };

        try {
            const res = await fetch(`${this.API_BASE}/requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newRequest)
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 429) {
                    const error = new Error(data.message || 'Weekly reservation limit reached.');
                    error.status = res.status;
                    throw error;
                }
                console.error(data.message || `Server returned error: ${res.status}`);
                return null;
            }
            const savedRequest = data.request;
            if (!savedRequest) {
                throw new Error('The server response did not contain the saved request.');
            }
            console.log('[SUCCESS] Request saved to Supabase:', savedRequest.id);
            return savedRequest;
        } catch (e) {
            if (e.status === 429) throw e;
            console.error('Failed to save request:', e);
            return null;
        }
    }

    async getAllRequests() {
        const res = await fetch(`${this.API_BASE}/requests`);
        if (!res.ok) throw new Error('Failed to fetch requests from server');
        const data = await res.json();
        return data.requests || [];
    }

    generateId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

export const requestService = new RequestService();
