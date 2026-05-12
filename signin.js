const brokerForm = document.querySelector("[data-broker-form]");
const brokerOutput = document.querySelector("[data-broker-output]");
const savedAppKey = localStorage.getItem("forexAppKey") || "";
const appKeyInput = brokerForm?.querySelector("[name='appKey']");

if (savedAppKey && appKeyInput) {
  appKeyInput.placeholder = `Saved in this browser (${savedAppKey.slice(0, 4)}...${savedAppKey.slice(-4)})`;
  brokerOutput.dataset.state = "success";
  brokerOutput.textContent = `Browser-saved FOREX.com AppKey loaded (${savedAppKey.slice(0, 4)}...${savedAppKey.slice(-4)}). Leave AppKey blank.`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error(`Server returned ${response.status}: ${text.replace(/\s+/g, " ").trim().slice(0, 120)}`);
  }

  return text ? JSON.parse(text) : {};
}

async function loadForexConfig() {
  try {
    const response = await fetch("/api/forexcom/config");
    const data = await readJsonResponse(response);
    if (data.hasAppKey) {
      brokerOutput.dataset.state = "success";
      brokerOutput.textContent = `Saved FOREX.com AppKey loaded (${data.appKey}). Enter username and password to connect.`;
    } else if (savedAppKey) {
      brokerOutput.dataset.state = "success";
      brokerOutput.textContent = "Browser-saved FOREX.com AppKey loaded. Enter username and password to connect.";
    }
  } catch (error) {
    if (savedAppKey) {
      brokerOutput.dataset.state = "success";
      brokerOutput.textContent = "Browser-saved FOREX.com AppKey loaded. Enter username and password to connect.";
    } else {
      brokerOutput.dataset.state = "error";
      brokerOutput.textContent = "FOREX.com config unavailable until the server is running.";
    }
  }
}

brokerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  brokerOutput.textContent = "Connecting to FOREX.com...";
  brokerOutput.dataset.state = "pending";

  const formData = new FormData(brokerForm);
  const payload = Object.fromEntries(formData.entries());
  const typedAppKey = String(payload.appKey || "").trim();
  const currentSavedAppKey = localStorage.getItem("forexAppKey") || "";
  payload.appKey = typedAppKey || currentSavedAppKey || savedAppKey || "";

  if (typedAppKey) {
    localStorage.setItem("forexAppKey", typedAppKey);
    payload.appKey = typedAppKey;
  }

  try {
    const response = await fetch("/api/forexcom/connect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Connection failed.");
    }

    if (payload.appKey) {
      localStorage.setItem("forexAppKey", payload.appKey);
    }
    localStorage.setItem("forexSessionId", data.localSessionId);
    window.location.href = "/dashboard.html";
  } catch (error) {
    brokerOutput.dataset.state = "error";
    brokerOutput.textContent = error.message;
  }
});

loadForexConfig();
