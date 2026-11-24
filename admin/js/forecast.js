import { Forecast } from '/scripts/ForecastTab.js';
import { Forecast as UserForecast } from '/src/components/ForecastComponent.js';

const container = document.getElementById('admin-forecast-content');
const userForecastContainer = document.createElement('div');
userForecastContainer.id = 'admin-user-forecast-content';
userForecastContainer.className = 'forecast-container';

const adminForecastContainer = document.createElement('div');
adminForecastContainer.id = 'admin-analytics-content';

container?.append(adminForecastContainer);
container?.append(userForecastContainer);

const userForecast = new UserForecast('admin-user-forecast-content');
const adminForecast = new Forecast(adminForecastContainer, { includeRevenue: true });

async function renderAnalytics() {
    await Promise.all([
        userForecast.render(),
        adminForecast.render(),
    ]);

    const revenueSection = adminForecastContainer.querySelector('.admin-revenue-section');
    if (revenueSection) {
        revenueSection.insertAdjacentElement('afterend', userForecastContainer);
    }
}

document.querySelector('.tab-trigger[data-tab="forecast"]')?.addEventListener('click', renderAnalytics);
