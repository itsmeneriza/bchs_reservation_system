import { AnalyticsForecast, FacilityForecast } from './FacilityForecast.js';

const container = document.getElementById('admin-forecast-content');
const facilityForecastContainer = document.createElement('div');
facilityForecastContainer.id = 'admin-facility-forecast-content';
facilityForecastContainer.className = 'forecast-container';

const adminForecastContainer = document.createElement('div');
adminForecastContainer.id = 'admin-analytics-content';

container?.append(adminForecastContainer);
container?.append(facilityForecastContainer);

const facilityForecast = new FacilityForecast('admin-facility-forecast-content');
const adminForecast = new AnalyticsForecast(adminForecastContainer);

async function renderAnalytics() {
    await Promise.all([
        facilityForecast.render(),
        adminForecast.render(),
    ]);

    const revenueSection = adminForecastContainer.querySelector('.admin-revenue-section');
    if (revenueSection) {
        revenueSection.insertAdjacentElement('afterend', facilityForecastContainer);
    }
}

document.querySelector('.tab-trigger[data-tab="forecast"]')?.addEventListener('click', renderAnalytics);
