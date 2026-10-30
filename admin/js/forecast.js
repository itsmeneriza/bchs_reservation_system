import { Forecast } from '/scripts/ForecastTab.js';

const forecast = new Forecast('admin-forecast-content', { includeRevenue: true });

document.querySelector('.tab-trigger[data-tab="forecast"]')?.addEventListener('click', () => {
    forecast.render();
});
