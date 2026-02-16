(function () {
  "use strict";

  var PRIMARY_URL = "http://localhost:5678/webhook/analytics-chat";
  var FALLBACK_URL = "http://localhost:5678/webhook-test/analytics-chat";

  var form = document.getElementById("chatForm");
  var messageInput = document.getElementById("message");
  var userIdInput = document.getElementById("userId");
  var submitButton = document.getElementById("submitButton");
  var submitButtonText = document.getElementById("submitButtonText");
  var runAgainButton = document.getElementById("runAgainButton");
  var retryButton = document.getElementById("retryButton");
  var statusMessage = document.getElementById("statusMessage");

  var messageError = document.getElementById("messageError");

  var resultsSection = document.getElementById("resultsSection");
  var resultsContainer = document.getElementById("resultsContainer");
  var emptyState = document.getElementById("emptyState");

  var errorSection = document.getElementById("errorSection");
  var errorStatus = document.getElementById("errorStatus");
  var errorMessage = document.getElementById("errorMessage");

  var isSubmitting = false;
  var lastRequestSnapshot = null;

  form.addEventListener("submit", handleSubmit);
  retryButton.addEventListener("click", handleRetry);
  runAgainButton.addEventListener("click", handleRunAgain);

  setStatus("Ready.");

  function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    clearFieldErrors();
    hideError();

    var validation = validateForm();
    if (!validation.valid) {
      messageInput.focus();
      return;
    }

    var payload = buildPayload(validation.message, validation.userId);
    lastRequestSnapshot = payload;
    executeRequest(payload);
  }

  function handleRetry() {
    if (isSubmitting || !lastRequestSnapshot) {
      return;
    }
    executeRequest(lastRequestSnapshot);
  }

  function handleRunAgain() {
    form.reset();
    clearFieldErrors();
    clearResults();
    hideError();
    hideRunAgain();
    lastRequestSnapshot = null;
    setSubmitting(false);
    setStatus("Ready.");
    messageInput.focus();
  }

  function validateForm() {
    var message = (messageInput.value || "").trim();
    var userId = (userIdInput.value || "").trim();

    if (!message) {
      setFieldError(messageError, "Message is required.");
      return { valid: false, message: "", userId: "" };
    }

    return {
      valid: true,
      message: message,
      userId: userId
    };
  }

  function buildPayload(message, userId) {
    var payload = {
      message: message,
      sessionId: generateSessionId()
    };

    if (userId) {
      payload.userId = userId;
    }

    return payload;
  }

  async function executeRequest(payload) {
    setSubmitting(true);
    showRunAgain();
    clearResults();
    hideError();
    setStatus("Thinking...");

    try {
      var primaryResult = await requestOnce(PRIMARY_URL, payload);

      if (primaryResult.kind === "success") {
        renderResults(primaryResult.data);
        setStatus("Completed.");
        return;
      }

      if (primaryResult.kind === "http" || primaryResult.kind === "network") {
        var fallbackResult = await requestOnce(FALLBACK_URL, payload);
        if (fallbackResult.kind === "success") {
          renderResults(fallbackResult.data);
          setStatus("Completed (test webhook).");
          return;
        }
        throw toDisplayError(fallbackResult);
      }

      throw toDisplayError(primaryResult);
    } catch (error) {
      renderError(normalizeDisplayError(error));
      setStatus("Request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestOnce(url, payload) {
    var response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      return {
        kind: "network",
        url: url,
        message: "Could not reach the webhook."
      };
    }

    if (!response.ok) {
      return {
        kind: "http",
        url: url,
        status: response.status,
        statusText: response.statusText || ""
      };
    }

    var rawText;
    try {
      rawText = await response.text();
    } catch (error) {
      return {
        kind: "parse",
        url: url,
        status: response.status,
        statusText: response.statusText || "",
        message: "Unable to read the response body."
      };
    }

    var parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      return {
        kind: "parse",
        url: url,
        status: response.status,
        statusText: response.statusText || "",
        message: "Webhook returned non-JSON content."
      };
    }

    if (!isFlatObject(parsed)) {
      return {
        kind: "shape",
        url: url,
        status: response.status,
        statusText: response.statusText || "",
        message: "Webhook response must be a flat JSON object."
      };
    }

    return {
      kind: "success",
      url: url,
      status: response.status,
      statusText: response.statusText || "",
      data: parsed
    };
  }

  function isFlatObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i += 1) {
      var child = value[keys[i]];
      if (child !== null && typeof child === "object") {
        return false;
      }
    }
    return true;
  }

  function renderResults(data) {
    hideError();
    resultsContainer.innerHTML = "";
    resultsSection.classList.remove("hidden");

    var keys = Object.keys(data);
    if (keys.length === 0) {
      emptyState.classList.remove("hidden");
      return;
    }
    emptyState.classList.add("hidden");

    keys.forEach(function (key) {
      var valueString = stringifyValue(data[key]);
      var longValue = isLongValue(valueString);

      var row = document.createElement("article");
      row.className = "result-row";

      var keyCell = document.createElement("div");
      keyCell.className = "result-key";
      keyCell.textContent = key;

      var valueCell = document.createElement("div");
      valueCell.className = "result-value";

      var valueNode;
      if (longValue) {
        valueNode = document.createElement("pre");
        valueNode.className = "value-block";
      } else {
        valueNode = document.createElement("p");
        valueNode.className = "value-line";
      }
      valueNode.textContent = valueString;

      var copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "copy-btn";
      copyButton.textContent = "Copy";
      copyButton.addEventListener("click", function () {
        copyToClipboard(copyButton, valueString);
      });

      valueCell.appendChild(valueNode);
      valueCell.appendChild(copyButton);
      row.appendChild(keyCell);
      row.appendChild(valueCell);
      resultsContainer.appendChild(row);
    });
  }

  function renderError(error) {
    clearResults();
    errorSection.classList.remove("hidden");
    errorStatus.textContent = error.status
      ? "HTTP " + error.status + (error.statusText ? " " + error.statusText : "")
      : "Request error";
    errorMessage.textContent = error.message;
    retryButton.disabled = !lastRequestSnapshot;
  }

  function hideError() {
    errorSection.classList.add("hidden");
    errorStatus.textContent = "";
    errorMessage.textContent = "";
    retryButton.disabled = isSubmitting || !lastRequestSnapshot;
  }

  function clearResults() {
    resultsContainer.innerHTML = "";
    emptyState.classList.add("hidden");
    resultsSection.classList.add("hidden");
  }

  function showRunAgain() {
    runAgainButton.classList.remove("hidden");
  }

  function hideRunAgain() {
    runAgainButton.classList.add("hidden");
  }

  function setSubmitting(submitting) {
    isSubmitting = submitting;
    submitButton.disabled = submitting;
    retryButton.disabled = submitting || !lastRequestSnapshot;
    submitButtonText.textContent = submitting ? "Thinking..." : "Send";
  }

  function setStatus(text) {
    statusMessage.textContent = text;
  }

  function setFieldError(element, text) {
    element.textContent = text;
    element.classList.remove("hidden");
  }

  function clearFieldErrors() {
    messageError.textContent = "";
    messageError.classList.add("hidden");
  }

  function stringifyValue(value) {
    if (value === null) {
      return "null";
    }
    return typeof value === "string" ? value : String(value);
  }

  function isLongValue(text) {
    return text.length > 120 || text.indexOf("\n") !== -1;
  }

  function generateSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "session-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  async function copyToClipboard(button, value) {
    var copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch (error) {
        copied = false;
      }
    }

    if (!copied) {
      copied = legacyCopy(value);
    }

    var originalText = button.textContent;
    button.textContent = copied ? "Copied" : "Copy failed";
    button.disabled = true;

    window.setTimeout(function () {
      button.textContent = originalText;
      button.disabled = false;
    }, 1200);
  }

  function legacyCopy(value) {
    var temp = document.createElement("textarea");
    temp.value = value;
    temp.setAttribute("readonly", "");
    temp.style.position = "absolute";
    temp.style.left = "-9999px";
    document.body.appendChild(temp);
    temp.select();

    var success = false;
    try {
      success = document.execCommand("copy");
    } catch (error) {
      success = false;
    }

    document.body.removeChild(temp);
    return success;
  }

  function toDisplayError(outcome) {
    if (outcome.kind === "http") {
      return {
        message: "Webhook returned a non-success status.",
        status: outcome.status,
        statusText: outcome.statusText || ""
      };
    }

    if (outcome.kind === "network") {
      return {
        message: outcome.message || "Network request failed.",
        status: null,
        statusText: ""
      };
    }

    return {
      message: outcome.message || "Unexpected response error.",
      status: outcome.status || null,
      statusText: outcome.statusText || ""
    };
  }

  function normalizeDisplayError(error) {
    if (error && typeof error === "object") {
      return {
        message: String(error.message || "An unexpected error occurred."),
        status: typeof error.status === "number" ? error.status : null,
        statusText: typeof error.statusText === "string" ? error.statusText : ""
      };
    }
    return {
      message: "An unexpected error occurred.",
      status: null,
      statusText: ""
    };
  }
})();
