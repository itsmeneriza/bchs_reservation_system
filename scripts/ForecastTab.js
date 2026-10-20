/**
 * Forecast Component
 * AI-powered analytics and predictions with year-over-year comparison
 */

export class Forecast {
    constructor(container = 'forecast-container') {
        this.container = typeof container === 'string'
            ? document.getElementById(container)
            : container;
        this.lastYearData = null;
        this.currentYearData = null;
        this._cachedForecast = null;
        this.yoyFacilitySelection = 'all';
        this.busyPatternSelection = 'all';
        this.facilityActivitySelection = null;

        // Pre-warm the cache immediately on construction
        fetch('/api/forecast')
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data?.forecast) this._cachedForecast = data.forecast; })
            .catch(() => {});
    }

    async loadData() {
        // Single fetch for both years — history.json holds all archived records
        // accepted.json holds upcoming approved reservations (future months of 2026).
        // We fetch both once and derive lastYearData / currentYearData from them.
        try {
            const currentYear = new Date().getFullYear();
            const lastYear    = currentYear - 1;

            const [historyRes, acceptedRes] = await Promise.all([
                fetch('/api/history').catch(() => null),
                fetch('/api/accepted').catch(() => null)
            ]);

            const historyRaw  = historyRes?.ok  ? await historyRes.json()  : [];
            const acceptedRaw = acceptedRes?.ok ? await acceptedRes.json() : [];

            const historyRecords  = Array.isArray(historyRaw)  ? historyRaw  : [];
            const acceptedRecords = Array.isArray(acceptedRaw) ? acceptedRaw : (acceptedRaw.accepted || []);

            // last year: all history records that fall in lastYear
            this.lastYearData = historyRecords.filter(r =>
                r.date && new Date(r.date).getFullYear() === lastYear
            );

            // current year: history records for currentYear  +  accepted records for currentYear
            // deduplicate by id (accepted is the source of truth for any record that exists in both)
            const seen = new Set();
            this.currentYearData = [
                ...acceptedRecords.filter(r => r.date && new Date(r.date).getFullYear() === currentYear),
                ...historyRecords .filter(r => r.date && new Date(r.date).getFullYear() === currentYear)
            ].filter(r => {
                if (!r.id || seen.has(r.id)) return false;
                seen.add(r.id);
                return true;
            });
        } catch (e) {
            console.error("Failed to load reservation data", e);
        }
    }

    // Kept for backward compatibility — delegates to loadData()
    async loadLastYearData()   { await this.loadData(); }
    async loadCurrentYearData() { /* already loaded by loadData() */ }

    calculateYearStats(records, targetYear) {
        if (!records || records.length === 0) {
            return null;
        }

        const filtered = records.filter(r => {
            if (!r.date) return false;
            if (targetYear && new Date(r.date).getFullYear() !== targetYear) return false;
            return r.status === 'approved' || !r.status;
        });

        if (filtered.length === 0) return null;

        const stats = {
            totalreservations: filtered.length,
            byRoom: {},
            byMonth: {},
            byDayOfWeek: {},
            totalAttendees: 0,
            averageAttendees: 0
        };

        filtered.forEach(reservation => {
            if (!stats.byRoom[reservation.roomId]) {
                stats.byRoom[reservation.roomId] = {
                    count: 0,
                    attendees: 0
                };
            }
            stats.byRoom[reservation.roomId].count++;
            stats.byRoom[reservation.roomId].attendees += reservation.attendees || 0;

            const month = new Date(reservation.date).toLocaleString('default', { month: 'long' });
            if (!stats.byMonth[month]) {
                stats.byMonth[month] = 0;
            }
            stats.byMonth[month]++;

            const dayOfWeek = new Date(reservation.date).toLocaleString('default', { weekday: 'long' });
            if (!stats.byDayOfWeek[dayOfWeek]) {
                stats.byDayOfWeek[dayOfWeek] = 0;
            }
            stats.byDayOfWeek[dayOfWeek]++;

            stats.totalAttendees += reservation.attendees || 0;
        });

        stats.averageAttendees = Math.round(stats.totalAttendees / stats.totalreservations);

        let maxCount = 0;
        let mostPopular = '';
        Object.keys(stats.byRoom).forEach(roomId => {
            if (stats.byRoom[roomId].count > maxCount) {
                maxCount = stats.byRoom[roomId].count;
                mostPopular = roomId;
            }
        });
        stats.mostPopularRoom = mostPopular;

        let maxMonthCount = 0;
        let busiestMonth = '';
        Object.keys(stats.byMonth).forEach(month => {
            if (stats.byMonth[month] > maxMonthCount) {
                maxMonthCount = stats.byMonth[month];
                busiestMonth = month;
            }
        });
        stats.busiestMonth = busiestMonth;
        stats.busiestMonthCount = maxMonthCount;

        let maxDayCount = 0;
        let busiestDay = '';
        Object.keys(stats.byDayOfWeek).forEach(day => {
            if (stats.byDayOfWeek[day] > maxDayCount) {
                maxDayCount = stats.byDayOfWeek[day];
                busiestDay = day;
            }
        });
        stats.busiestDayOfWeek = busiestDay;
        stats.busiestDayCount = maxDayCount;

        return stats;
    }

    calculateLastYearStats(targetYear) {
        return this.calculateYearStats(this.lastYearData, targetYear);
    }

    calculateCurrentYearStats(targetYear) {
        return this.calculateYearStats(this.currentYearData, targetYear);
    }

    calculateComparison(currentStats, lastYearStats) {
        if (!lastYearStats || !currentStats) return null;

        const comparison = {
            totalChange: currentStats.totalreservations - lastYearStats.totalreservations,
            totalChangePercent: lastYearStats.totalreservations > 0 
                ? Math.round(((currentStats.totalreservations - lastYearStats.totalreservations) / lastYearStats.totalreservations) * 100)
                : 0,
            attendeesChange: currentStats.averageAttendees - lastYearStats.averageAttendees,
            attendeesChangePercent: lastYearStats.averageAttendees > 0
                ? Math.round(((currentStats.averageAttendees - lastYearStats.averageAttendees) / lastYearStats.averageAttendees) * 100)
                : 0,
            roomComparisons: {}
        };

        const currentRoomAnalytics = Array.isArray(currentStats.roomAnalytics)
            ? currentStats.roomAnalytics
            : Object.keys(currentStats.byRoom || {}).map(roomId => ({ roomId, totalreservations: currentStats.byRoom[roomId].count }));

        currentRoomAnalytics.forEach(item => {
            const roomId = item.roomId;
            const current = item.totalreservations ?? item.count ?? 0;
            const lastYear = lastYearStats.byRoom[roomId];

            if (lastYear) {
                comparison.roomComparisons[roomId] = {
                    change: current - lastYear.count,
                    changePercent: lastYear.count > 0
                        ? Math.round(((current - lastYear.count) / lastYear.count) * 100)
                        : 0
                };
            }
        });

        return comparison;
    }

    bindYoYFilters() {
        const buttons = this.container?.querySelectorAll('.yoy-filter-btn') || [];
        buttons.forEach((btn) => {
            if (btn.dataset.yoyBound === 'true') return;
            btn.dataset.yoyBound = 'true';
            btn.addEventListener('click', () => {
                const selected = btn.dataset.facility;
                const section = btn.closest('.year-comparison-section');
                const wrap = section?.querySelector('.yoy-chart-wrap');
                if (!wrap) return;

                this.yoyFacilitySelection = selected;
                section.querySelectorAll('.yoy-filter-btn').forEach((b) => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });

                const svg = wrap.querySelector('.yoy-svg-chart');
                const isAll = selected === 'all';
                const chartWidth = Number(svg?.dataset.chartWidth);
                const padLeft = Number(svg?.dataset.padLeft);
                const padTop = Number(svg?.dataset.padTop);
                const plotHeight = Number(svg?.dataset.plotHeight);
                const facilityLines = [...wrap.querySelectorAll(`.yoy-facility-line[data-facility="${selected}"]`)];
                const facilityValues = facilityLines.flatMap((line) => line.dataset.values.split(',').map(Number));
                const maxValue = isAll
                    ? Number(svg?.dataset.allYMax)
                    : Math.max(4, Math.ceil(Math.max(...facilityValues) / 4) * 4);

                wrap.querySelectorAll('.yoy-series-all, .yoy-series-all-marker, .yoy-series-last').forEach((series) => {
                    series.style.display = isAll ? '' : 'none';
                });
                wrap.querySelectorAll('.yoy-facility-line').forEach((line) => {
                    const show = !isAll && line.dataset.facility === selected;
                    line.style.display = show ? 'inline' : 'none';
                    if (show && svg && maxValue > 0) {
                        const values = line.dataset.values.split(',').map(Number);
                        const plotWidth = chartWidth - padLeft - Number(svg.dataset.padRight);
                        const points = values.map((value, index) => {
                            const x = padLeft + (index * plotWidth) / (values.length - 1);
                            const y = padTop + plotHeight - (value / maxValue) * plotHeight;
                            return `${x},${y}`;
                        }).join(' ');
                        line.setAttribute('points', points);
                    }
                });

                const grid = wrap.querySelector('.yoy-grid');
                grid?.querySelectorAll('.yoy-grid-tick').forEach((tick, index) => {
                    const value = (maxValue * index) / 4;
                    const y = padTop + plotHeight - (value / maxValue) * plotHeight;
                    const line = tick.querySelector('line');
                    const label = tick.querySelector('text');
                    line?.setAttribute('y1', String(y));
                    line?.setAttribute('y2', String(y));
                    label?.setAttribute('y', String(y + 4));
                    if (label) label.textContent = String(Math.round(value));
                });

                const currentLegend = wrap.querySelector('.yoy-legend-current');
                if (currentLegend) {
                    currentLegend.style.display = isAll ? '' : 'inline-flex';
                    currentLegend.querySelector('.yoy-legend-dot').style.background = isAll
                        ? '#0ea5e9'
                        : btn.dataset.color;
                    currentLegend.querySelector('.yoy-legend-current-label').textContent = isAll
                        ? currentLegend.dataset.allLabel
                        : `${btn.textContent.trim()} (${currentLegend.dataset.year})`;
                }
                wrap.querySelectorAll('.yoy-legend-last-year, .yoy-legend-future-ref').forEach((legend) => {
                    legend.style.display = isAll ? '' : 'none';
                });
                const facilityLastLegend = wrap.querySelector('.yoy-legend-facility-last');
                if (facilityLastLegend) {
                    facilityLastLegend.style.display = isAll ? 'none' : 'inline-flex';
                    facilityLastLegend.querySelector('.yoy-legend-facility-last-label').textContent =
                        `${facilityLastLegend.dataset.year} (${btn.textContent.trim()})`;
                }

                const chart = wrap.querySelector('.yoy-svg-chart');
                if (chart) {
                    chart.setAttribute(
                        'aria-label',
                        isAll
                            ? 'Year-over-Year monthly reservations line chart for all facilities'
                            : `Monthly reservations line chart for ${btn.textContent.trim()}`
                    );
                }

            });
        });
    }

    async render() {
        if (!this.container) return;

        // Fetch history + accepted once; derives both lastYearData and currentYearData
        await this.loadData();

        let forecast = null;
        try {
            const timeout = new Promise(resolve => setTimeout(() => resolve(null), 3000));
            const fetchForecast = fetch('/api/forecast')
                .then(res => res.ok ? res.json() : null)
                .then(data => data?.forecast || null)
                .catch(() => null);

            const result = await Promise.race([fetchForecast, timeout]);
            if (result) {
                forecast = result;
                this._cachedForecast = forecast; // store for fallback
            } else {
                // Timed out — use last cached if available
                forecast = this._cachedForecast || null;
            }
        } catch (e) {
            forecast = this._cachedForecast || null;
        }

        if (!forecast) {
            this.container.innerHTML = `
                <div class="forecast-loading">
                    <div class="spinner"></div>
                    <p>Loading forecast data...</p>
                </div>
            `;
            return;
        }

        const currentYear = new Date().getFullYear();
        const analyzedYear = forecast.analyzedYear || (currentYear - 1);
        const baselineYears = Array.isArray(forecast.yearsIncluded) && forecast.yearsIncluded.length
            ? forecast.yearsIncluded
            : [analyzedYear];
        const currentYearStats = this.calculateCurrentYearStats(currentYear);
        const lastYearStats = this.calculateLastYearStats(analyzedYear);
        const { summary, roomAnalytics, weeklyTrends, aheadPredictions, recommendations } = forecast;
        const comparison = this.calculateComparison(
            {
                ...currentYearStats,
                roomAnalytics,
                byRoom: currentYearStats ? currentYearStats.byRoom : {},
                averageAttendees: currentYearStats ? currentYearStats.averageAttendees : summary.averageAttendees || 0,
                totalreservations: currentYearStats ? currentYearStats.totalreservations : summary.totalreservations || 0,
                mostPopularRoom: currentYearStats ? currentYearStats.mostPopularRoom : summary.mostPopularRoom || 'N/A'
            },
            lastYearStats
        );

        const currentSummary = currentYearStats || {
            totalreservations: summary.totalreservations || 0,
            averageAttendees: summary.averageAttendees || 0,
            mostPopularRoom: summary.mostPopularRoom || 'N/A'
        };
        const isAdminView = this.container?.id === 'admin-forecast-content';
        const facilityOverviewMarkup = isAdminView ? `
            <!-- Hero Stats Section -->
            <div class="forecast-hero">
                <div class="hero-header">
                    <div>
                        <h2 class="hero-title">Facility Overview</h2>
                        <p class="hero-subtitle">Real-time insights and predictions for BCHS facilities</p>
                        <p class="forecast-baseline">Forecast baseline: historical data from ${baselineYears.join(' and ')}</p>
                    </div>
                    <div class="last-updated">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <span>Updated ${this.formatTimeAgo(forecast.lastUpdated)}</span>
                    </div>
                </div>
                
                <div class="hero-stats">
                    <div class="hero-stat-card primary">
                        <div class="hero-stat-icon"></div>
                        <div class="hero-stat-content">
                            <div class="hero-stat-value">${currentSummary.totalreservations}</div>
                            <div class="hero-stat-label">Total Reservations</div>
                            ${comparison ? this.renderChangeIndicator(comparison.totalChange, comparison.totalChangePercent) : ''}
                        </div>
                    </div>
                    <div class="hero-stat-card secondary">
                        <div class="hero-stat-icon"></div>
                        <div class="hero-stat-content">
                            <div class="hero-stat-value">${currentSummary.mostPopularRoom}</div>
                            <div class="hero-stat-label">Most Popular Venue</div>
                        </div>
                    </div>
                    <div class="hero-stat-card accent">
                        <div class="hero-stat-icon"></div>
                        <div class="hero-stat-content">
                            <div class="hero-stat-value">${summary.peakHours}</div>
                            <div class="hero-stat-label">Peak Hours</div>
                        </div>
                    </div>
                    <div class="hero-stat-card success">
                        <div class="hero-stat-icon"></div>
                        <div class="hero-stat-content">
                            <div class="hero-stat-value">${currentSummary.averageAttendees}</div>
                            <div class="hero-stat-label">Avg Attendees</div>
                            ${comparison ? this.renderChangeIndicator(comparison.totalChange, comparison.totalChangePercent) : ''}
                        </div>
                    </div>
                </div>
            </div>
        ` : '';

        this.container.innerHTML = `
            ${facilityOverviewMarkup}

            <!-- Year Comparison - Prominent Position -->
            ${lastYearStats ? this.renderYearComparison(lastYearStats, currentSummary, forecast.analyzedYear, this.currentYearData) : ''}

            <!-- Busy Patterns Analysis -->
            ${lastYearStats ? this.renderBusyPatterns(lastYearStats) : ''}

            <!-- Room Analytics -->
            <div class="forecast-section">
                <div class="section-header">
                    <h3 class="section-title">
                        <span class="title-icon"></span>
                        Facility Activity
                    </h3>
                    <span class="section-badge" data-activity-count>${roomAnalytics.length} facilities</span>
                </div>

                <div class="facility-activity-legend" aria-label="Forecast facility legend">
                    <div class="facility-activity-legend-item">
                        <span class="facility-activity-legend-swatch facility-activity-legend-confidence facility-activity-legend-high"></span>
                        <span>High confidence</span>
                    </div>
                    <div class="facility-activity-legend-item">
                        <span class="facility-activity-legend-swatch facility-activity-legend-confidence facility-activity-legend-medium"></span>
                        <span>Medium confidence</span>
                    </div>
                    <div class="facility-activity-legend-item">
                        <span class="facility-activity-legend-swatch facility-activity-legend-confidence facility-activity-legend-low"></span>
                        <span>Estimated</span>
                    </div>
                </div>

                ${this.renderPerformanceRanking(roomAnalytics)}
                <div class="room-analytics-grid">
                    ${this.rankRooms(roomAnalytics).map((room, idx) => this.renderRoomAnalytics(room, comparison, idx)).join('')}
                </div>
            </div>
            <!-- Ahead Predictions -->
            ${(aheadPredictions || weeklyTrends?.filter(t => t.week.startsWith('Predicted')) || []).length > 0 ? `
            <div class="forecast-section">
                <div class="section-header">
                    <h3 class="section-title">
                        <span class="title-icon"></span>
                        3-Month Ahead Forecast
                    </h3>
                    <span class="section-badge" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0;">Predicted</span>
                </div>
                <div style="font-size:0.78rem;color:#64748b;margin-bottom:0.75rem;padding:0 0.25rem;">
                    Based on historical patterns and year-over-year growth trends.
                </div>
                <div class="trends-grid">
                    ${(aheadPredictions || weeklyTrends.filter(t => t.week.startsWith('Predicted'))).map(trend => this.renderWeeklyTrend(trend)).join('')}
                </div>
            </div>` : ''}
        `;

        this.bindYoYFilters();
        this.bindBusyPatternFilters();
        this.bindFacilityActivityFilters();
    }

    bindFacilityActivityFilters() {
        const buttons = this.container?.querySelectorAll('[data-activity-facility]') || [];
        const clearButton = this.container?.querySelector('[data-activity-clear]');
        const cards = this.container?.querySelectorAll('.room-card[data-room-id]') || [];
        const countBadge = this.container?.querySelector('[data-activity-count]');
        const total = cards.length;

        const updateSelection = () => {
            let visibleCount = 0;
            cards.forEach(card => {
                const isVisible = !this.facilityActivitySelection
                    || card.dataset.roomId === this.facilityActivitySelection;
                card.hidden = !isVisible;
                if (isVisible) visibleCount += 1;
            });

            buttons.forEach(button => {
                const selected = button.dataset.activityFacility === this.facilityActivitySelection;
                button.setAttribute('aria-pressed', selected ? 'true' : 'false');
            });

            if (countBadge) {
                countBadge.textContent = this.facilityActivitySelection
                    ? `${visibleCount} of ${total} facilities`
                    : `${total} facilities`;
            }
        };

        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const selected = button.dataset.activityFacility;
                this.facilityActivitySelection = this.facilityActivitySelection === selected
                    ? null
                    : selected;
                updateSelection();
            });
        });

        clearButton?.addEventListener('click', () => {
            this.facilityActivitySelection = null;
            updateSelection();
        });

        updateSelection();
    }

    formatTimeAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }

    renderChangeIndicator(change, changePercent) {
        if (change === 0) return '<div class="stat-change neutral">No change</div>';
        
        const isPositive = change > 0;
        const arrow = isPositive ? '↑' : '↓';
        const colorClass = isPositive ? 'positive' : 'negative';
        
        return `
            <div class="stat-change ${colorClass}">
                ${arrow} ${Math.abs(change)} (${Math.abs(changePercent)}%) vs last year
            </div>
        `;
    }

    renderYearComparison(lastYearStats, currentStats, analyzedYear, currentYearData) {
        const totalDiff = currentStats.totalreservations - lastYearStats.totalreservations;
        const totalPercent = lastYearStats.totalreservations > 0 
            ? Math.round((totalDiff / lastYearStats.totalreservations) * 100) 
            : 0;

        // Use the analyzed year from forecast, or calculate current year - 1
        const lastYear = analyzedYear || (new Date().getFullYear() - 1);
        const currentYear = lastYear + 1;

        // ── Facility definitions ─────────────────────────────────────────────
        const FACILITIES = [
            { id: 'all',        label: 'All',        color: '#0ea5e9' },
            { id: 'auditorium', label: 'Auditorium', color: '#800020' },
            { id: 'library',    label: 'Library',    color: '#059669' },
            { id: 'grounds',    label: 'Grounds',    color: '#d97706' },
            { id: 'gym',        label: 'Gym',        color: '#7c3aed' },
            { id: 'avr',        label: 'AVR',        color: '#db2777' },
        ];

        // ── Build monthly data for both years ───────────────────────────────
        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

        // this.lastYearData is pre-filtered to lastYear by loadData().
        // Approved filter: status==='approved' OR no status (seeded historical records).
        const lyApproved = (this.lastYearData || []).filter(r =>
            r.date && (r.status === 'approved' || !r.status)
        );

        const buildLastYearPerFacility = (roomId) =>
            MONTHS.map((_, i) => {
                const prefix = `${lastYear}-${String(i + 1).padStart(2, '0')}`;
                return lyApproved.filter(r => r.date.startsWith(prefix) && r.roomId === roomId).length;
            });

        const lastYearAllMonthly = MONTHS.map((_, i) => {
            const prefix = `${lastYear}-${String(i + 1).padStart(2, '0')}`;
            return lyApproved.filter(r => r.date.startsWith(prefix)).length;
        });

        // this.currentYearData is pre-filtered to currentYear by loadData().
        // accepted.json records are always approved; history 2026 records are filtered to approved.
        // Additional guard: only count approved status (blocks/rejects/refusals are excluded).
        const cyApproved = (currentYearData || []).filter(r =>
            r.date && r.status === 'approved'
        );

        const buildCurrentYearPerFacility = (roomId) =>
            MONTHS.map((_, i) => {
                const prefix = `${currentYear}-${String(i + 1).padStart(2, '0')}`;
                return cyApproved.filter(r => r.date.startsWith(prefix) && r.roomId === roomId).length;
            });

        const currentYearAllMonthly = MONTHS.map((_, i) => {
            const prefix = `${currentYear}-${String(i + 1).padStart(2, '0')}`;
            return cyApproved.filter(r => r.date.startsWith(prefix)).length;
        });

        // Pre-compute datasets keyed by facility id
        const datasets = {};
        FACILITIES.forEach(f => {
            if (f.id === 'all') {
                datasets['all'] = {
                    lastYear:    lastYearAllMonthly,
                    currentYear: currentYearAllMonthly
                };
            } else {
                datasets[f.id] = {
                    lastYear:    buildLastYearPerFacility(f.id),
                    currentYear: buildCurrentYearPerFacility(f.id)
                };
            }
        });

        // ── SVG layout constants ─────────────────────────────────────────────
        const W = 680, H = 220;
        const padL = 40, padR = 16, padT = 16, padB = 34;
        const chartW = W - padL - padR;
        const chartH = H - padT - padB;
        const xStep  = chartW / (MONTHS.length - 1);
        const toX    = i => padL + i * xStep;

        // X-axis month labels (static — same for all facilities)
        const xLabels = MONTHS.map((m, i) =>
            `<text x="${toX(i)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#94a3b8">${m}</text>`
        ).join('');

        // Unique chart id to scope the script
        const chartId = `yoy-chart-${Date.now()}`;

        // Current month index (0-based). Months 0..currentMonthIdx = past (solid line).
        // Months currentMonthIdx+1..11 are future approved bookings.
        const currentMonthIdx = new Date().getMonth(); // 0=Jan … 11=Dec

        const allVals = lastYearAllMonthly.concat(currentYearAllMonthly);
        const yMax = Math.max(...allVals, 1);
        const toY = val => padT + chartH - (val / yMax) * chartH;

        const seriesFor = values => values.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
        const lastYearPoints = seriesFor(lastYearAllMonthly);
        const currentAllPoints = seriesFor(currentYearAllMonthly);

        const facilitySeries = FACILITIES.filter(f => f.id !== 'all').map(f => {
            const lastYearValues = datasets[f.id].lastYear;
            const currentYearValues = datasets[f.id].currentYear;
            return `
                <polyline class="yoy-facility-line yoy-facility-line-last" data-facility="${f.id}" data-values="${lastYearValues.join(',')}" points="${seriesFor(lastYearValues)}"
                          fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5 4"
                          stroke-linejoin="round" stroke-linecap="round" style="display:none"/>
                <polyline class="yoy-facility-line yoy-facility-line-current" data-facility="${f.id}" data-values="${currentYearValues.join(',')}" points="${seriesFor(currentYearValues)}"
                          fill="none" stroke="${f.color}" stroke-width="2.5"
                          stroke-linejoin="round" stroke-linecap="round" style="display:none"/>
            `;
        }).join('');

        // Static SVG shell with actual SVG lines rendered directly so they are visible in the DOM.
        const svgChart = `
            <svg id="${chartId}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
                 class="yoy-svg-chart" aria-label="Year-over-Year monthly reservations line chart for all facilities"
                 data-chart-width="${W}" data-pad-left="${padL}" data-pad-right="${padR}"
                 data-pad-top="${padT}" data-plot-height="${chartH}" data-all-y-max="${yMax}">
                <defs>
                    <linearGradient id="yoy-grad-last-${chartId}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#94a3b8" stop-opacity="0.18"/>
                        <stop offset="100%" stop-color="#94a3b8" stop-opacity="0"/>
                    </linearGradient>
                    <linearGradient id="yoy-grad-curr-${chartId}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.18"/>
                        <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                ${xLabels}
                <g id="${chartId}-grid" class="yoy-grid">
                    ${Array.from({ length: 5 }, (_, t) => {
                        const val = Math.round((yMax / 4) * t);
                        const y = toY(val);
                        return `
                            <g class="yoy-grid-tick">
                                <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0" stroke-width="1"></line>
                                <text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="9" fill="#94a3b8">${val}</text>
                            </g>
                        `;
                    }).join('')}
                </g>
                <polygon class="yoy-series-last" points="${toX(0)},${padT + chartH} ${lastYearPoints} ${toX(MONTHS.length - 1)},${padT + chartH}" fill="url(#yoy-grad-last-${chartId})"></polygon>
                <polyline class="yoy-series-last" points="${lastYearPoints}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
                <polygon class="yoy-series-all" points="${toX(0)},${padT + chartH} ${currentAllPoints} ${toX(currentMonthIdx)},${padT + chartH}" fill="url(#yoy-grad-curr-${chartId})"></polygon>
                <polyline class="yoy-series-all" points="${currentAllPoints}" fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></polyline>
                <line x1="${toX(currentMonthIdx)}" y1="${padT}" x2="${toX(currentMonthIdx)}" y2="${padT + chartH}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 3"></line>
                <text x="${toX(currentMonthIdx) + 3}" y="${padT + 8}" font-size="7" fill="#94a3b8">today</text>
                ${facilitySeries}
                ${lastYearAllMonthly.map((v, i) => `<circle class="yoy-series-last" cx="${toX(i)}" cy="${toY(v)}" r="3.5" fill="#94a3b8" stroke="#fff" stroke-width="1.5"></circle>`).join('')}
                ${currentYearAllMonthly.map((v, i) => `<circle class="yoy-series-all-marker" cx="${toX(i)}" cy="${toY(v)}" r="3.5" fill="${i <= currentMonthIdx ? '#0ea5e9' : '#fff'}" stroke="#0ea5e9" stroke-width="2" opacity="${i <= currentMonthIdx ? '1' : '0.85'}"></circle>`).join('')}
            </svg>
        `;

        // Facility filter buttons
        const filterButtons = FACILITIES.map(f => `
            <button class="yoy-filter-btn ${f.id === 'all' ? 'active' : ''}"
                    data-facility="${f.id}"
                    data-chart="${chartId}"
                    data-color="${f.color}"
                    aria-pressed="${f.id === 'all' ? 'true' : 'false'}"
                    style="--btn-color:${f.color}">
                ${f.label}
            </button>
        `).join('');

        const toggleScript = '';

        return `
            <div class="year-comparison-section">
                <div class="section-header">
                    <h3 class="section-title">
                        <span class="title-icon"></span>
                        Activity Overview
                    </h3>
                    <div class="comparison-summary ${totalDiff >= 0 ? 'positive' : 'negative'}">
                        <span class="summary-icon">${totalDiff >= 0 ? '+' : '-'}</span>
                        <span class="summary-text">
                            ${totalDiff >= 0 ? '+' : ''}${totalPercent}% ${totalDiff >= 0 ? 'growth' : 'decline'} from last year
                        </span>
                    </div>
                </div>

                <!-- Facility filter buttons -->
                <div class="yoy-filter-bar">
                    ${filterButtons}
                </div>

                <div class="yoy-chart-wrap">
                    <!-- Legend -->
                    <div class="yoy-legend">
                        <span class="yoy-legend-item yoy-legend-last-year">
                            <span class="yoy-legend-dot" style="background:#94a3b8"></span>
                            ${lastYear}
                        </span>
                        <span class="yoy-legend-item yoy-legend-current" data-all-label="${currentYear}" data-year="${currentYear}">
                            <span class="yoy-legend-dot yoy-legend-curr-dot" style="background:#0ea5e9"></span>
                            <span class="yoy-legend-current-label">${currentYear}</span>
                        </span>
                        <span class="yoy-legend-item yoy-legend-facility-last" data-year="${lastYear}" style="display:none">
                            <span class="yoy-legend-dot-dash yoy-legend-facility-last-dash"></span>
                            <span class="yoy-legend-facility-last-label">${lastYear}</span>
                        </span>
                        <span class="yoy-legend-item yoy-legend-future-ref">
                            <span class="yoy-legend-dot-dash yoy-legend-future-dash"></span>
                            Scheduled
                        </span>
                    </div>
                    ${svgChart}
                </div>

                <div class="insights-panel" style="margin-top:1rem;">
                    <h4 class="insights-title">
                        <span></span>
                        Key Insights
                    </h4>
                    <div class="insights-list">
                        ${this.generateInsights(lastYearStats, currentStats)}
                    </div>
                </div>
            </div>
        `;
    }

    getRoomName(roomId) {
        const roomNames = {
            'auditorium': 'Auditorium',
            'library': 'Library',
            'grounds': 'Grounds',
            'gym': 'Gym',
            'avr': 'AVR'
        };
        return roomNames[roomId] || roomId;
    }

    generateInsights(lastYear, current) {
        const insights = [];
        
        const totalDiff = current.totalreservations - lastYear.totalreservations;
        const totalPercent = lastYear.totalreservations > 0 
            ? Math.round((totalDiff / lastYear.totalreservations) * 100) 
            : 0;
        
        if (totalDiff > 0) {
            insights.push(`
                <div class="insight-item positive">
                    <div class="insight-icon">+</div>
                    <div class="insight-content">
                        <div class="insight-text">Reservations increased by <strong>${totalDiff}</strong> compared to last year</div>
                        <div class="insight-badge positive">+${totalPercent}%</div>
                    </div>
                </div>
            `);
        } else if (totalDiff < 0) {
            insights.push(`
                <div class="insight-item negative">
                    <div class="insight-icon">-</div>
                    <div class="insight-content">
                        <div class="insight-text">Reservations decreased by <strong>${Math.abs(totalDiff)}</strong> compared to last year</div>
                        <div class="insight-badge negative">${totalPercent}%</div>
                    </div>
                </div>
            `);
        } else {
            insights.push(`
                <div class="insight-item neutral">
                    <div class="insight-icon">=</div>
                    <div class="insight-content">
                        <div class="insight-text">Reservation volume remained stable compared to last year</div>
                    </div>
                </div>
            `);
        }

        const attendeesDiff = current.averageAttendees - lastYear.averageAttendees;
        if (attendeesDiff !== 0) {
            const isPositive = attendeesDiff > 0;
            insights.push(`
                <div class="insight-item ${isPositive ? 'positive' : 'negative'}">
                    <div class="insight-icon"></div>
                    <div class="insight-content">
                        <div class="insight-text">Average event size ${isPositive ? 'grew' : 'decreased'} by <strong>${Math.abs(attendeesDiff)} attendees</strong></div>
                    </div>
                </div>
            `);
        }

        if (current.mostPopularRoom !== lastYear.mostPopularRoom) {
            insights.push(`
                <div class="insight-item info">
                    <div class="insight-icon"></div>
                    <div class="insight-content">
                        <div class="insight-text">Most popular venue shifted from <strong>${this.getRoomName(lastYear.mostPopularRoom)}</strong> to <strong>${current.mostPopularRoom}</strong></div>
                    </div>
                </div>
            `);
        }

        return insights.join('');
    }

        getBusyPatternFacilities() {
            return [
                { id: 'all', label: 'All', color: '#0ea5e9' },
                { id: 'auditorium', label: 'Auditorium', color: '#800020' },
                { id: 'library', label: 'Library', color: '#059669' },
                { id: 'grounds', label: 'Grounds', color: '#d97706' },
                { id: 'gym', label: 'Gym', color: '#7c3aed' },
                { id: 'avr', label: 'AVR', color: '#db2777' }
            ];
        }

        getBusyDayData(facilityId = 'all') {
            const baseDayOrder = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayOrder = facilityId === 'grounds'
                ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
                : baseDayOrder;
            const counts = Object.fromEntries(dayOrder.map(day => [day, 0]));

            const records = Array.isArray(this.lastYearData) ? this.lastYearData : [];
            records.filter(reservation => {
                if (!reservation?.date) return false;
                if (reservation.status && reservation.status !== 'approved') return false;
                if (facilityId !== 'all' && reservation.roomId !== facilityId) return false;
                const day = new Date(reservation.date).toLocaleString('default', { weekday: 'long' });
                if (facilityId === 'grounds' && (day === 'Saturday' || day === 'Sunday')) return false;
                return true;
            }).forEach(reservation => {
                const day = new Date(reservation.date).toLocaleString('default', { weekday: 'long' });
                if (counts[day] !== undefined) {
                    counts[day] += 1;
                }
            });

            const entries = dayOrder.map(day => [day, counts[day]]);
            const peakEntry = entries.reduce((best, current) => current[1] >= best[1] ? current : best, ['No data', 0]);
            const total = entries.reduce((sum, [, value]) => sum + value, 0);

            return { entries, peakEntry, total };
        }

        bindBusyPatternFilters() {
            const buttons = this.container?.querySelectorAll('.busy-pattern-filter-btn') || [];
            buttons.forEach((btn) => {
                if (btn.dataset.busyBound === 'true') return;
                btn.dataset.busyBound = 'true';
                btn.addEventListener('click', () => {
                    const selected = btn.dataset.facility || 'all';
                    this.busyPatternSelection = selected;

                    const section = btn.closest('.busy-patterns-section');
                    if (!section) return;

                    section.querySelectorAll('.busy-pattern-filter-btn').forEach((b) => {
                        const isActive = b === btn;
                        b.classList.toggle('active', isActive);
                        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                    });

                    const { entries, peakEntry, total } = this.getBusyDayData(selected);
                    const maxCount = Math.max(...entries.map(([, count]) => count), 1);
                    const chart = section.querySelector('.busy-pattern-bar-chart');
                    if (chart) {
                        chart.innerHTML = entries.map(([day, count]) => {
                            const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
                            const barHeight = (count / maxCount) * 100;
                            const dayShort = day.substring(0, 3);
                            return `
                                <div class="pattern-bar-item">
                                    <div class="bar-value">${count} <span class="bar-percent">(${percentage}%)</span></div>
                                    <div class="bar-container">
                                        <div class="bar-fill day-bar" style="height: ${barHeight}%"></div>
                                    </div>
                                    <div class="bar-label">${dayShort}</div>
                                </div>
                            `;
                        }).join('');
                    }

                    const highlightValue = section.querySelector('.busy-pattern-highlight .highlight-value');
                    const highlightCount = section.querySelector('.busy-pattern-highlight .highlight-count');
                    if (highlightValue) highlightValue.textContent = peakEntry[0];
                    if (highlightCount) highlightCount.textContent = `${peakEntry[1]} reservations`;

                    const insight = section.querySelector('.patterns-insight .insight-text');
                    if (insight) {
                        const label = this.getBusyPatternFacilities().find(f => f.id === selected)?.label || 'All';
                        const facilityText = selected === 'all' ? '' : ` for ${label}`;
                        const peakedDayLabel = peakEntry[0].endsWith('s') ? peakEntry[0] : `${peakEntry[0]}s`;
                        insight.innerHTML = `<strong>Planning Tip:</strong> ${peakedDayLabel} were historically the busiest${facilityText}. Consider booking early on these peak days or explore alternative dates for better availability.`;
                    }
                });
            });
        }

        renderBusyPatterns(lastYearStats) {
            const historicalYear = new Date().getFullYear() - 1;
            const facilityOptions = this.getBusyPatternFacilities();
            const selectedFacility = this.busyPatternSelection || 'all';
            const { entries, peakEntry, total } = this.getBusyDayData(selectedFacility);
            const maxCount = Math.max(...entries.map(([, count]) => count), 1);
            const filterButtons = facilityOptions.map(f => `
                <button class="yoy-filter-btn busy-pattern-filter-btn ${f.id === selectedFacility ? 'active' : ''}"
                        data-facility="${f.id}"
                        data-color="${f.color}"
                        aria-pressed="${f.id === selectedFacility ? 'true' : 'false'}"
                        style="--btn-color:${f.color}">
                    ${f.label}
                </button>
            `).join('');

            const dayBars = entries.map(([day, count]) => {
                const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
                const barHeight = (count / maxCount) * 100;
                const dayShort = day.substring(0, 3);
                const isUnavailable = selectedFacility === 'grounds' && (day === 'Saturday' || day === 'Sunday');
                return `
                    <div class="pattern-bar-item">
                        <div class="bar-value">${count} <span class="bar-percent">(${percentage}%)</span></div>
                        <div class="bar-container">
                            <div class="bar-fill ${isUnavailable ? 'unavailable-bar' : 'day-bar'}" style="height: ${barHeight}%"></div>
                        </div>
                        <div class="bar-label">${dayShort}</div>
                    </div>
                `;
            }).join('');

            const facilityLabel = facilityOptions.find(f => f.id === selectedFacility)?.label || 'All';
            const facilityText = selectedFacility === 'all' ? '' : ` for ${facilityLabel}`;
            const peakedDayLabel = peakEntry[0].endsWith('s') ? peakEntry[0] : `${peakEntry[0]}s`;

            return `
                <div class="forecast-section busy-patterns-section">
                    <div class="section-header">
                        <h3 class="section-title">
                            <span class="title-icon"></span>
                            Historical Busy Patterns (${historicalYear})
                        </h3>
                        <span class="section-badge">Based on ${lastYearStats.totalreservations} reservations</span>
                    </div>

                    <div class="yoy-filter-bar" style="margin-bottom:1rem;">
                        ${filterButtons}
                    </div>

                    <div class="patterns-grid">
                        <div class="pattern-card">
                            <div class="pattern-header">
                                <h4 class="pattern-title">
                                    <span class="pattern-icon"></span>
                                    Busiest Days of Week
                                </h4>
                            </div>
                            <div class="pattern-body">
                                <div class="pattern-highlight busy-pattern-highlight">
                                    <div class="highlight-label">Peak Day</div>
                                    <div class="highlight-value">${peakEntry[0]}</div>
                                    <div class="highlight-count">${peakEntry[1]} reservations</div>
                                </div>
                                <div class="pattern-bars busy-pattern-bar-chart">
                                    ${dayBars}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="patterns-insight">
                        <div class="insight-icon"></div>
                        <div class="insight-text">
                            <strong>Planning Tip:</strong> ${peakedDayLabel} were historically the busiest${facilityText}. Consider booking early on these peak days or explore alternative dates for better availability.
                        </div>
                    </div>
                </div>
            `;
        }

    /**
     * Sorts rooms by a composite score: utilization (40%) + reservations (40%) + avg attendees (20%)
     */
    rankRooms(roomAnalytics) {
        if (!roomAnalytics || roomAnalytics.length === 0) return [];
        const maxRes  = Math.max(...roomAnalytics.map(r => r.totalreservations), 1);
        const maxAtt  = Math.max(...roomAnalytics.map(r => r.averageAttendees), 1);
        return [...roomAnalytics].map(r => ({
            ...r,
            _score: (parseInt(r.utilizationRate) * 0.4) +
                    ((r.totalreservations / maxRes) * 100 * 0.4) +
                    ((r.averageAttendees / maxAtt) * 100 * 0.2)
        })).sort((a, b) => b._score - a._score);
    }

    renderPerformanceRanking(roomAnalytics) {
        if (!roomAnalytics || roomAnalytics.length === 0) return '';
        const ranked = this.rankRooms(roomAnalytics);
        const top = ranked[0];
        const medals = ['1st', '2nd', '3rd', '4th', '5th'];
        const maxRes = Math.max(...ranked.map(r => r.totalreservations), 1);

        const bars = ranked.map((room, idx) => {
            const barWidth = Math.round((room.totalreservations / maxRes) * 100);
            const medal = medals[idx] || `#${idx + 1}`;
            const trendColor = room.trend === 'increasing' ? '#16a34a' : room.trend === 'decreasing' ? '#dc2626' : '#64748b';
            const trendArrow = room.trend === 'increasing' ? '↑' : room.trend === 'decreasing' ? '↓' : '→';
            return `
                <button type="button" class="facility-ranking-button" data-activity-facility="${room.roomId}" aria-pressed="false" aria-label="Show ${room.roomName} room card">
                    <span class="facility-ranking-medal">${medal}</span>
                    <span class="facility-ranking-name">${room.roomName}</span>
                    <span class="facility-ranking-bar" aria-hidden="true">
                        <span style="width:${barWidth}%;"></span>
                    </span>
                    <span class="facility-ranking-bookings">${room.totalreservations}</span>
                    <span class="facility-ranking-trend" style="color:${trendColor};">${trendArrow}</span>
                </button>`;
        }).join('');

        return `
            <div class="facility-performance-ranking">
                <div class="facility-ranking-header">
                    <button type="button" class="facility-ranking-featured" data-activity-facility="${top.roomId}" aria-pressed="false">
                        Top Facility: ${top.roomName}
                    </button>
                    <span class="facility-ranking-summary">${top.utilizationRate} utilization · ${top.totalreservations} bookings</span>
                </div>
                <div class="facility-ranking-content">
                    <div class="facility-ranking-list">${bars}</div>
                    <button type="button" class="facility-ranking-clear" data-activity-clear>Show all facilities</button>
                </div>
                <div class="facility-ranking-hint">Select a facility to show only its room card. Select it again or choose “Show all facilities” to reset.</div>
            </div>`;
    }

    renderRoomAnalytics(room, comparison, rank = -1) {
        const trendIcon = room.trend === 'increasing' ? '+' : room.trend === 'decreasing' ? '-' : '=';
        const trendClass = room.trend === 'increasing' ? 'positive' : room.trend === 'decreasing' ? 'negative' : 'neutral';
        const roomComparison = comparison?.roomComparisons?.[room.roomId];

        // Get room icon
        const roomIcons = {
            'auditorium': 'AUD',
            'library': 'LIB',
            'grounds': 'GRD',
            'gym': 'GYM',
            'avr': 'AVR'
        };
        const roomIcon = roomIcons[room.roomId] || 'ROOM';

        const medals = ['1st', '2nd', '3rd', '4th', '5th'];
        const rankBadge = rank >= 0
            ? `<span style="position:absolute;top:-8px;left:-8px;font-size:0.65rem;font-weight:800;color:${rank === 0 ? '#800020' : '#64748b'};background:${rank === 0 ? '#fecdd3' : '#e2e8f0'};border-radius:999px;padding:2px 6px;line-height:1;" title="Rank #${rank+1}">${medals[rank] || `#${rank+1}`}</span>`
            : '';

        return `
            <div class="room-card" data-room-id="${room.roomId}" style="position:relative;">
                ${rankBadge}
                <div class="room-card-header">
                    <div class="room-info">
                        <span class="room-icon">${roomIcon}</span>
                        <div>
                            <h4 class="room-name">${room.roomName}</h4>
                            <span class="room-trend ${trendClass}">
                                ${trendIcon} ${room.trend}
                            </span>
                        </div>
                    </div>
                    <div class="room-utilization">
                        <div class="utilization-circle">
                            <svg viewBox="0 0 36 36" class="circular-chart">
                                <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                <path class="circle" stroke-dasharray="${room.utilizationRate.replace('%', '')}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                <text x="18" y="20.35" class="percentage">${room.utilizationRate}</text>
                            </svg>
                        </div>
                    </div>
                </div>

                <div class="room-card-body">
                    <div class="room-stats-grid">
                        <div class="room-stat">
                            <div class="room-stat-label">Total Reservations</div>
                            <div class="room-stat-value">${room.totalreservations}</div>
                            ${roomComparison ? `
                                <div class="room-stat-change ${roomComparison.change >= 0 ? 'positive' : 'negative'}">
                                    ${roomComparison.change >= 0 ? '↑' : '↓'} ${Math.abs(roomComparison.changePercent)}% vs last year
                                </div>
                            ` : ''}
                        </div>
                        <div class="room-stat">
                            <div class="room-stat-label">Avg Attendees</div>
                            <div class="room-stat-value">${room.averageAttendees}</div>
                        </div>
                        <div class="room-stat">
                            <div class="room-stat-label">Peak Days</div>
                            <div class="room-stat-value small">${Array.isArray(room.peakDays) ? room.peakDays.join(', ') : room.peakDays}</div>
                        </div>
                        <div class="room-stat prediction-stat">
                            <div class="room-stat-label">
                                <span></span> Next Week
                            </div>
                            <div class="room-stat-value">${room.predictedNextWeek}</div>
                            ${(() => {
                                const confColor = room.predictionConfidence === 'high' ? '#16a34a'
                                    : room.predictionConfidence === 'medium' ? '#d97706' : '#94a3b8';
                                const confLabel = room.predictionConfidence === 'high' ? 'High confidence'
                                    : room.predictionConfidence === 'medium' ? 'Medium confidence' : 'Estimated';
                                const confDot = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${confColor};margin-right:3px;vertical-align:middle;"></span>`;
                                return `<div style="font-size:0.65rem;color:${confColor};font-weight:600;margin-top:3px;">${confDot}${confLabel}</div>`;
                            })()}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderWeeklyTrend(trend) {
        const isCurrentWeek = trend.week.includes('Current');
        const isPrediction = trend.week.includes('Predicted');

        return `
            <div class="trend-card ${isPrediction ? 'prediction' : ''}">
                <div class="trend-header">
                    <h4>${trend.week}</h4>
                    ${isPrediction ? '<span class="prediction-badge">Predicted</span>' : ''}
                </div>
                <div class="trend-stats">
                    <div class="trend-stat">
                        <span class="trend-stat-label">Total:</span>
                        <span class="trend-stat-value">${trend.totalreservations}</span>
                    </div>
                    <div class="trend-breakdown">
                        <div class="trend-item">
                            <span>Auditorium:</span>
                            <strong>${trend.auditorium}</strong>
                        </div>
                        <div class="trend-item">
                            <span>Library:</span>
                            <strong>${trend.library}</strong>
                        </div>
                        <div class="trend-item">
                            <span>Grounds:</span>
                            <strong>${trend.grounds}</strong>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderWeeklyTrend(trend) {
        const isPrediction = trend.week.includes('Predicted');

        return `
            <div class="trend-card ${isPrediction ? 'prediction' : 'current'}">
                <div class="trend-card-header">
                    <h4 class="trend-title">${trend.week}</h4>
                    ${isPrediction ? '<span class="prediction-badge"><span></span> Prediction</span>' : '<span class="current-badge"><span></span> Actual Data</span>'}
                </div>
                <div class="trend-card-body">
                    <div class="trend-total">
                        <div class="trend-total-label">Total Reservations</div>
                        <div class="trend-total-value">${trend.totalreservations}</div>
                    </div>
                    <div class="trend-breakdown">
                        <div class="breakdown-item">
                            <div class="breakdown-bar">
                                <div class="breakdown-fill auditorium" style="width: ${(trend.auditorium / trend.totalreservations * 100)}%"></div>
                            </div>
                            <div class="breakdown-info">
                                <span class="breakdown-icon"></span>
                                <span class="breakdown-name">Auditorium</span>
                                <span class="breakdown-value">${trend.auditorium}</span>
                            </div>
                        </div>
                        <div class="breakdown-item">
                            <div class="breakdown-bar">
                                <div class="breakdown-fill library" style="width: ${(trend.library / trend.totalreservations * 100)}%"></div>
                            </div>
                            <div class="breakdown-info">
                                <span class="breakdown-icon"></span>
                                <span class="breakdown-name">Library</span>
                                <span class="breakdown-value">${trend.library}</span>
                            </div>
                        </div>
                        <div class="breakdown-item">
                            <div class="breakdown-bar">
                                <div class="breakdown-fill grounds" style="width: ${(trend.grounds / trend.totalreservations * 100)}%"></div>
                            </div>
                            <div class="breakdown-info">
                                <span class="breakdown-icon"></span>
                                <span class="breakdown-name">Grounds</span>
                                <span class="breakdown-value">${trend.grounds}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderRecommendation(rec) {
        const priorityConfig = {
            high: { color: '#ef4444', icon: 'HIGH', label: 'High Priority' },
            medium: { color: '#f59e0b', icon: 'MED', label: 'Medium Priority' },
            low: { color: '#10b981', icon: 'LOW', label: 'Low Priority' }
        };

        const config = priorityConfig[rec.priority] || priorityConfig.medium;

        return `
            <div class="recommendation-card ${rec.priority}">
                <div class="recommendation-priority-badge" style="background-color: ${config.color}">
                    <span class="priority-icon">${config.icon}</span>
                    <span class="priority-label">${config.label}</span>
                </div>
                <div class="recommendation-content">
                    <p class="recommendation-text">${rec.message}</p>
                </div>
                <div class="recommendation-action">
                    <button class="action-btn" onclick="alert('Feature coming soon!')">
                        <span>Take Action</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }
}
