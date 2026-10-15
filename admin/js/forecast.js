import { Forecast } from '/scripts/ForecastTab.js';

const forecast = new Forecast('admin-forecast-content');

document.querySelector('.tab-trigger[data-tab="forecast"]')?.addEventListener('click', () => {
    forecast.render();
});
