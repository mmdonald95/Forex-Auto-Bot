const riskSlider = document.querySelector("[data-risk-slider]");
const stopSlider = document.querySelector("[data-stop-slider]");
const riskValue = document.querySelector("[data-risk-value]");
const stopValue = document.querySelector("[data-stop-value]");
const leadForm = document.querySelector("[data-lead-form]");
const formSuccess = document.querySelector("[data-form-success]");

function formatPercent(value) {
  return `${Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 2).replace(/0$/, "")}%`;
}

function syncControlLabels() {
  riskValue.textContent = formatPercent(riskSlider.value);
  stopValue.textContent = formatPercent(stopSlider.value);
}

riskSlider.addEventListener("input", syncControlLabels);
stopSlider.addEventListener("input", syncControlLabels);

leadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  formSuccess.hidden = false;
  leadForm.reset();
  syncControlLabels();
});

syncControlLabels();
