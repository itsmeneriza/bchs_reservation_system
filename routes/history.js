const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = function createHistoryRouter({ dataDir }) {
  const router = express.Router();
  const repoDataDir = dataDir;
  // --- History Archive Logic ---------------------------------------------------
  
  const historyPath = path.join(repoDataDir, 'history.json');
  
  function readHistory() {
    if (!fs.existsSync(historyPath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }
  
  function writeHistory(records) {
    fs.writeFileSync(historyPath, JSON.stringify(records, null, 2), 'utf8');
  }
  
  /**
   * Move past reservations (approved/blocked with date < today) into history.json.
   * Removes them from requests.json and accepted.json.
   */
  function archivePastReservations() {
    const today = new Date().toISOString().split('T')[0];
  
    // --- Archive from requests.json ---
    const requestsPath = path.join(repoDataDir, 'requests.json');
    if (fs.existsSync(requestsPath)) {
      const requestsData = JSON.parse(fs.readFileSync(requestsPath, 'utf8'));
      const active = [];
      const toArchive = [];
  
      (requestsData.requests || []).forEach(r => {
        const isPast = (r.status === 'approved' || r.status === 'blocked') && r.date < today;
        const isClosed = r.status === 'rejected' || r.status === 'refused';
        if (isPast || isClosed) toArchive.push(r);
        else active.push(r);
      });
  
      if (toArchive.length > 0) {
        const history = readHistory();
        const existingIds = new Set(history.map(h => h.id));
        toArchive.forEach(r => { if (!existingIds.has(r.id)) history.push(r); });
        writeHistory(history);
        requestsData.requests = active;
        fs.writeFileSync(requestsPath, JSON.stringify(requestsData, null, 2), 'utf8');
        console.log(`? Archived ${toArchive.length} past request(s) to history.json`);
      }
    }
  
    // --- Archive from accepted.json ---
    const acceptedPath = path.join(repoDataDir, 'accepted.json');
    if (fs.existsSync(acceptedPath)) {
      const accData = JSON.parse(fs.readFileSync(acceptedPath, 'utf8'));
      const active = [];
      const toArchive = [];
  
      (accData.accepted || []).forEach(r => {
        if (r.date < today) toArchive.push({ ...r, status: r.status || 'approved' });
        else active.push(r);
      });
  
      if (toArchive.length > 0) {
        const history = readHistory();
        const existingIds = new Set(history.map(h => h.id));
        toArchive.forEach(r => { if (!existingIds.has(r.id)) history.push(r); });
        writeHistory(history);
        accData.accepted = active;
        fs.writeFileSync(acceptedPath, JSON.stringify(accData, null, 2), 'utf8');
        console.log(`? Archived ${toArchive.length} past accepted reservation(s) to history.json`);
      }
    }
  }
  
  // GET history
  router.get('/api/history', (_req, res) => {
    try {
      res.status(200).json(readHistory());
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to read history', error: error.message });
    }
  });
  
  // POST history � archive a single record directly into history.json
  router.post('/api/history', (req, res) => {
    try {
      const entry = req.body;
      if (!entry || !entry.id) return res.status(400).json({ success: false, message: 'Invalid entry' });
  
      const history = readHistory();
      const existingIdx = history.findIndex(h => h.id === entry.id);
      if (existingIdx === -1) {
        history.push(entry);
      } else {
        history[existingIdx] = { ...history[existingIdx], ...entry };
      }
      writeHistory(history);
      console.log('? Entry archived to history:', entry.id);
      res.status(200).json({ success: true, message: 'Archived to history', entry });
    } catch (error) {
      console.error('? Error archiving to history:', error);
      res.status(500).json({ success: false, message: 'Failed to archive', error: error.message });
    }
  });
  
  // Run archive on startup and every hour
  archivePastReservations();
  setInterval(archivePastReservations, 60 * 60 * 1000);
  return { router, readHistory, archivePastReservations };
};
