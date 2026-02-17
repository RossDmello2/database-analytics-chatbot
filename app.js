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
  var metaToggleButton = document.getElementById("metaToggleButton");
  var retryButton = document.getElementById("retryButton");

  var statusMessage = document.getElementById("statusMessage");
  var statusMessageInline = document.getElementById("statusMessageInline");
  var messageError = document.getElementById("messageError");

  var welcomeState = document.getElementById("welcomeState");
  var resultsSection = document.getElementById("resultsSection");
  var chatTranscript = document.getElementById("chatTranscript");

  var metadataSection = document.getElementById("metadataSection");
  var resultsContainer = document.getElementById("resultsContainer");
  var emptyState = document.getElementById("emptyState");

  var errorSection = document.getElementById("errorSection");
  var errorStatus = document.getElementById("errorStatus");
  var errorMessage = document.getElementById("errorMessage");

  var isSubmitting = false;
  var lastRequestSnapshot = null;
  var pendingAssistantMessage = null;
  var metadataVisible = false;

  form.addEventListener("submit", handleSubmit);
  retryButton.addEventListener("click", handleRetry);
  runAgainButton.addEventListener("click", handleRunAgain);
  metaToggleButton.addEventListener("click", handleMetaToggle);

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
    lastRequestSnapshot = {
      payload: payload,
      userMessage: validation.message
    };

    showRunAgain();
    showConversation();
    clearTechnicalDetails();

    appendUserMessage(validation.message);
    pendingAssistantMessage = appendAssistantPendingMessage();

    messageInput.value = "";

    executeRequest(lastRequestSnapshot);
  }

  function handleRetry() {
    if (isSubmitting || !lastRequestSnapshot) {
      return;
    }

    hideError();
    showConversation();
    clearTechnicalDetails();

    pendingAssistantMessage = appendAssistantPendingMessage();
    executeRequest(lastRequestSnapshot);
  }

  function handleRunAgain() {
    form.reset();
    clearFieldErrors();
    hideError();
    clearConversation();
    clearTechnicalDetails();
    hideRunAgain();

    lastRequestSnapshot = null;
    pendingAssistantMessage = null;

    setSubmitting(false);
    setStatus("Ready.");
    messageInput.focus();
  }

  function handleMetaToggle() {
    if (metaToggleButton.classList.contains("hidden")) {
      return;
    }

    metadataVisible = !metadataVisible;

    if (metadataVisible) {
      metadataSection.classList.remove("hidden");
      metaToggleButton.textContent = "Hide technical details";
      if ("open" in metadataSection) {
        metadataSection.open = true;
      }
      return;
    }

    metadataSection.classList.add("hidden");
    metaToggleButton.textContent = "Show technical details";
    if ("open" in metadataSection) {
      metadataSection.open = false;
    }
  }

  function validateForm() {
    var message = (messageInput.value || "").trim();
    var userId = (userIdInput.value || "").trim();

    if (!message) {
      setFieldError(messageError, "Message is required.");
      return {
        valid: false,
        message: "",
        userId: ""
      };
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

  async function executeRequest(snapshot) {
    setSubmitting(true);
    setStatus("Thinking...");

    try {
      var primaryResult = await requestOnce(PRIMARY_URL, snapshot.payload);
      if (primaryResult.kind === "success") {
        renderSuccess(primaryResult.data, false);
        return;
      }

      if (primaryResult.kind === "http" || primaryResult.kind === "network") {
        var fallbackResult = await requestOnce(FALLBACK_URL, snapshot.payload);
        if (fallbackResult.kind === "success") {
          renderSuccess(fallbackResult.data, true);
          return;
        }
        throw toDisplayError(fallbackResult);
      }

      throw toDisplayError(primaryResult);
    } catch (error) {
      renderFailure(normalizeDisplayError(error));
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

    if (!rawText) {
      return {
        kind: "parse",
        url: url,
        status: response.status,
        statusText: response.statusText || "",
        message: "Webhook returned an empty body."
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

    return {
      kind: "success",
      url: url,
      status: response.status,
      statusText: response.statusText || "",
      data: parsed
    };
  }

  function renderSuccess(data, usedFallback) {
    hideError();

    var extraction = extractAssistantPayload(data);
    finalizeAssistantMessage(extraction.text, false);
    renderTechnicalDetails(extraction.metadata);

    setStatus(usedFallback ? "Completed (test webhook)." : "Completed.");
    scrollTranscriptToBottom();
  }

  function renderFailure(error) {
    finalizeAssistantMessage("I could not complete this request. Please retry.", true);
    renderError(error);
    setStatus("Request failed.");
    scrollTranscriptToBottom();
  }

  function extractAssistantPayload(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return {
        text: stringifyValue(data),
        metadata: {}
      };
    }

    var keyOrder = ["response", "answer", "message", "result"];
    var keys = Object.keys(data);
    var primaryKey = "";
    var primaryValue;

    for (var i = 0; i < keyOrder.length; i += 1) {
      var preferred = keyOrder[i];
      if (Object.prototype.hasOwnProperty.call(data, preferred) && hasDisplayValue(data[preferred])) {
        primaryKey = preferred;
        primaryValue = data[preferred];
        break;
      }
    }

    if (!primaryKey) {
      for (var k = 0; k < keys.length; k += 1) {
        var candidateKey = keys[k];
        var candidateValue = data[candidateKey];
        if (typeof candidateValue === "string" && candidateValue.trim()) {
          primaryKey = candidateKey;
          primaryValue = candidateValue;
          break;
        }
      }
    }

    var text;
    if (primaryKey) {
      text = stringifyValue(primaryValue);
    } else if (keys.length > 0) {
      text = safeJsonStringify(data);
    } else {
      text = "No data returned.";
    }

    var metadata = {};
    for (var m = 0; m < keys.length; m += 1) {
      var key = keys[m];
      if (key !== primaryKey) {
        metadata[key] = data[key];
      }
    }

    return {
      text: text,
      metadata: metadata
    };
  }

  function hasDisplayValue(value) {
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return true;
  }

  function showConversation() {
    welcomeState.classList.add("hidden");
    resultsSection.classList.remove("hidden");
  }

  function clearConversation() {
    chatTranscript.innerHTML = "";
    resultsSection.classList.add("hidden");
    welcomeState.classList.remove("hidden");
  }

  function appendUserMessage(text) {
    appendMessage({
      role: "user",
      title: "You",
      text: text,
      renderMarkdown: false,
      pending: false,
      copyValue: ""
    });
  }

  function appendAssistantPendingMessage() {
    return appendMessage({
      role: "assistant",
      title: "Assistant",
      text: "Thinking...",
      renderMarkdown: false,
      pending: true,
      copyValue: ""
    });
  }

  function appendMessage(config) {
    var row = document.createElement("article");
    row.className = "message-row " + config.role;

    var card = document.createElement("div");
    card.className = "message-card";

    var meta = document.createElement("div");
    meta.className = "message-meta";

    var roleNode = document.createElement("span");
    roleNode.className = "message-role";
    roleNode.textContent = config.title;

    var timeNode = document.createElement("span");
    timeNode.className = "message-time";
    timeNode.textContent = formatTime(new Date());

    meta.appendChild(roleNode);
    meta.appendChild(timeNode);

    var body = document.createElement("div");
    body.className = "message-body";

    if (config.renderMarkdown) {
      var markdownNode = document.createElement("div");
      markdownNode.className = "markdown-output";
      markdownNode.innerHTML = renderMarkdownToHtml(config.text);
      body.appendChild(markdownNode);
    } else {
      var textNode = document.createElement("p");
      textNode.className = "user-text";

      if (config.pending) {
        textNode.classList.add("pending");
        textNode.innerHTML =
          "Thinking... <span class=\"pending-dots\"><span></span><span></span><span></span></span>";
      } else {
        textNode.textContent = config.text;
      }

      body.appendChild(textNode);
    }

    card.appendChild(meta);
    card.appendChild(body);

    var actions = document.createElement("div");
    actions.className = "message-actions";

    if (config.copyValue) {
      var copyButton = createCopyButton(config.copyValue);
      actions.appendChild(copyButton);
      card.appendChild(actions);
    }

    row.appendChild(card);
    chatTranscript.appendChild(row);

    scrollTranscriptToBottom();

    return {
      row: row,
      body: body,
      actions: actions,
      roleNode: roleNode,
      timeNode: timeNode,
      card: card
    };
  }

  function finalizeAssistantMessage(text, isErrorMessage) {
    if (!pendingAssistantMessage) {
      pendingAssistantMessage = appendAssistantPendingMessage();
    }

    pendingAssistantMessage.body.innerHTML = "";

    var markdownNode = document.createElement("div");
    markdownNode.className = "markdown-output";
    markdownNode.innerHTML = renderMarkdownToHtml(text);

    pendingAssistantMessage.body.appendChild(markdownNode);

    if (pendingAssistantMessage.actions.parentNode !== pendingAssistantMessage.card) {
      pendingAssistantMessage.card.appendChild(pendingAssistantMessage.actions);
    }

    pendingAssistantMessage.actions.innerHTML = "";

    if (!isErrorMessage) {
      var copyButton = createCopyButton(text);
      pendingAssistantMessage.actions.appendChild(copyButton);
    }

    pendingAssistantMessage.timeNode.textContent = formatTime(new Date());
    pendingAssistantMessage = null;
  }

  function createCopyButton(value) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy-btn";
    button.textContent = "Copy";
    button.addEventListener("click", function () {
      copyToClipboard(button, value);
    });
    return button;
  }

  function renderTechnicalDetails(metadata) {
    resultsContainer.innerHTML = "";

    var keys = Object.keys(metadata || {});
    if (keys.length === 0) {
      metadataVisible = false;
      metaToggleButton.classList.add("hidden");
      metaToggleButton.textContent = "Show technical details";
      metadataSection.classList.add("hidden");
      emptyState.classList.add("hidden");
      return;
    }

    metadataVisible = false;
    metaToggleButton.classList.remove("hidden");
    metaToggleButton.textContent = "Show technical details";
    emptyState.classList.add("hidden");
    metadataSection.classList.add("hidden");
    if ("open" in metadataSection) {
      metadataSection.open = false;
    }

    keys.forEach(function (key) {
      var value = stringifyValue(metadata[key]);
      var longValue = value.length > 120 || value.indexOf("\n") !== -1;

      var card = document.createElement("article");
      card.className = "meta-card";

      var keyNode = document.createElement("p");
      keyNode.className = "meta-key";
      keyNode.textContent = key;

      var valueNode = document.createElement("pre");
      valueNode.className = longValue ? "meta-value long" : "meta-value";
      valueNode.textContent = value;

      var copyButton = createCopyButton(value);

      card.appendChild(keyNode);
      card.appendChild(valueNode);
      card.appendChild(copyButton);
      resultsContainer.appendChild(card);
    });
  }

  function clearTechnicalDetails() {
    resultsContainer.innerHTML = "";
    emptyState.classList.add("hidden");
    metadataVisible = false;
    metaToggleButton.classList.add("hidden");
    metaToggleButton.textContent = "Show technical details";
    metadataSection.classList.add("hidden");
    if ("open" in metadataSection) {
      metadataSection.open = false;
    }
  }

  function renderError(error) {
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

  function showRunAgain() {
    runAgainButton.classList.remove("hidden");
  }

  function hideRunAgain() {
    runAgainButton.classList.add("hidden");
  }

  function setSubmitting(submitting) {
    isSubmitting = submitting;
    submitButton.disabled = submitting;
    runAgainButton.disabled = submitting;
    retryButton.disabled = submitting || !lastRequestSnapshot;
    submitButtonText.textContent = submitting ? "Thinking..." : "Send";
  }

  function setStatus(text) {
    statusMessage.textContent = text;
    if (statusMessageInline) {
      statusMessageInline.textContent = text;
    }
  }

  function setFieldError(element, text) {
    element.textContent = text;
    element.classList.remove("hidden");
  }

  function clearFieldErrors() {
    messageError.textContent = "";
    messageError.classList.add("hidden");
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function scrollTranscriptToBottom() {
    chatTranscript.scrollTo({
      top: chatTranscript.scrollHeight,
      behavior: "smooth"
    });
  }

  function stringifyValue(value) {
    if (value === null) {
      return "null";
    }
    if (value === undefined) {
      return "undefined";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return safeJsonStringify(value);
  }

  function safeJsonStringify(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value);
    }
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

  function renderMarkdownToHtml(rawText) {
    var source = normalizeMarkdownSource(rawText);
    if (!source) {
      return "<p>No response returned.</p>";
    }

    var lines = source.split("\n");
    var blocks = [];
    var index = 0;

    while (index < lines.length) {
      var line = lines[index];

      if (isBlank(line)) {
        index += 1;
        continue;
      }

      if (isFenceStart(line)) {
        var fence = parseCodeFence(lines, index);
        blocks.push(fence.block);
        index = fence.nextIndex;
        continue;
      }

      if (isHeadingLine(line)) {
        var headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
        blocks.push({
          type: "heading",
          level: headingMatch[1].length,
          text: headingMatch[2].trim()
        });
        index += 1;
        continue;
      }

      if (isBlockQuoteLine(line)) {
        var quoteLines = [];
        while (index < lines.length && isBlockQuoteLine(lines[index])) {
          quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
          index += 1;
        }
        blocks.push({
          type: "blockquote",
          text: quoteLines.join("\n")
        });
        continue;
      }

      if (isTableStart(lines, index)) {
        var table = parseTable(lines, index);
        blocks.push(table.block);
        index = table.nextIndex;
        continue;
      }

      if (isUnorderedListLine(line)) {
        var unordered = parseList(lines, index, false);
        blocks.push(unordered.block);
        index = unordered.nextIndex;
        continue;
      }

      if (isOrderedListLine(line)) {
        var ordered = parseList(lines, index, true);
        blocks.push(ordered.block);
        index = ordered.nextIndex;
        continue;
      }

      var paragraph = parseParagraph(lines, index);
      blocks.push(paragraph.block);
      index = paragraph.nextIndex;
    }

    return blocks.map(renderMarkdownBlock).join("");
  }

  function normalizeMarkdownSource(value) {
    var text = String(value == null ? "" : value);

    text = text.replace(/\r\n?/g, "\n");
    text = text.replace(/[\u200B-\u200D\uFEFF]/g, "");
    text = text.replace(/^\s*\*+\s*$/gm, "");
    text = text.replace(/(^|\s)\*(?=\s|$)/g, "$1");
    text = text.replace(/\n{3,}/g, "\n\n");

    return text.trim();
  }

  function parseCodeFence(lines, startIndex) {
    var opening = lines[startIndex].trim();
    var lang = opening.slice(3).trim().split(/\s+/)[0] || "";
    var codeLines = [];
    var cursor = startIndex + 1;

    while (cursor < lines.length && !/^```/.test(lines[cursor].trim())) {
      codeLines.push(lines[cursor]);
      cursor += 1;
    }

    if (cursor < lines.length) {
      cursor += 1;
    }

    return {
      block: {
        type: "code",
        lang: lang,
        text: codeLines.join("\n")
      },
      nextIndex: cursor
    };
  }

  function parseTable(lines, startIndex) {
    var header = splitTableRow(lines[startIndex]);
    var rows = [];
    var cursor = startIndex + 2;

    while (cursor < lines.length) {
      var line = lines[cursor];
      if (isBlank(line)) {
        break;
      }
      if (!line.includes("|")) {
        break;
      }
      if (isFenceStart(line) || isHeadingLine(line) || isBlockQuoteLine(line) || isUnorderedListLine(line) || isOrderedListLine(line)) {
        break;
      }
      rows.push(splitTableRow(line));
      cursor += 1;
    }

    return {
      block: {
        type: "table",
        header: header,
        rows: rows
      },
      nextIndex: cursor
    };
  }

  function parseList(lines, startIndex, ordered) {
    var matcher = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-+*]\s+(.*)$/;
    var items = [];
    var cursor = startIndex;

    while (cursor < lines.length) {
      var current = lines[cursor].match(matcher);
      if (!current) {
        break;
      }

      var itemParts = [current[1].trim()];
      cursor += 1;

      while (cursor < lines.length) {
        var nextLine = lines[cursor];

        if (isBlank(nextLine)) {
          break;
        }

        if (matcher.test(nextLine)) {
          break;
        }

        if (
          isFenceStart(nextLine) ||
          isHeadingLine(nextLine) ||
          isBlockQuoteLine(nextLine) ||
          (!ordered && isOrderedListLine(nextLine)) ||
          (ordered && isUnorderedListLine(nextLine)) ||
          isTableStart(lines, cursor)
        ) {
          break;
        }

        itemParts.push(nextLine.trim());
        cursor += 1;
      }

      items.push(itemParts.join(" "));

      if (cursor < lines.length && isBlank(lines[cursor])) {
        var lookAhead = cursor;
        while (lookAhead < lines.length && isBlank(lines[lookAhead])) {
          lookAhead += 1;
        }
        if (lookAhead < lines.length && matcher.test(lines[lookAhead])) {
          cursor = lookAhead;
          continue;
        }
        cursor = lookAhead;
        break;
      }
    }

    return {
      block: {
        type: ordered ? "ol" : "ul",
        items: items
      },
      nextIndex: cursor
    };
  }

  function parseParagraph(lines, startIndex) {
    var parts = [lines[startIndex].trim()];
    var cursor = startIndex + 1;

    while (cursor < lines.length) {
      var line = lines[cursor];

      if (isBlank(line)) {
        break;
      }

      if (
        isFenceStart(line) ||
        isHeadingLine(line) ||
        isBlockQuoteLine(line) ||
        isUnorderedListLine(line) ||
        isOrderedListLine(line) ||
        isTableStart(lines, cursor)
      ) {
        break;
      }

      parts.push(line.trim());
      cursor += 1;
    }

    return {
      block: {
        type: "paragraph",
        text: parts.join("\n")
      },
      nextIndex: cursor
    };
  }

  function renderMarkdownBlock(block) {
    if (block.type === "heading") {
      var level = Math.min(6, Math.max(1, block.level));
      return "<h" + level + ">" + renderInlineMarkdown(block.text) + "</h" + level + ">";
    }

    if (block.type === "paragraph") {
      return "<p>" + renderInlineMarkdown(block.text) + "</p>";
    }

    if (block.type === "blockquote") {
      return "<blockquote>" + renderInlineMarkdown(block.text) + "</blockquote>";
    }

    if (block.type === "code") {
      var label = block.lang
        ? '<div class="code-label">' + escapeHtml(block.lang) + "</div>"
        : "";
      return (
        '<div class="code-wrap">' +
        label +
        "<pre><code>" +
        escapeHtml(block.text) +
        "</code></pre></div>"
      );
    }

    if (block.type === "ul" || block.type === "ol") {
      var itemsHtml = block.items
        .map(function (item) {
          return "<li>" + renderInlineMarkdown(item) + "</li>";
        })
        .join("");
      return "<" + block.type + ">" + itemsHtml + "</" + block.type + ">";
    }

    if (block.type === "table") {
      var headerHtml = block.header
        .map(function (cell) {
          return "<th>" + renderInlineMarkdown(cell) + "</th>";
        })
        .join("");

      var rowsHtml = block.rows
        .map(function (row) {
          var cells = row
            .map(function (cell) {
              return "<td>" + renderInlineMarkdown(cell) + "</td>";
            })
            .join("");
          return "<tr>" + cells + "</tr>";
        })
        .join("");

      return (
        '<div class="table-wrap"><table><thead><tr>' +
        headerHtml +
        "</tr></thead><tbody>" +
        rowsHtml +
        "</tbody></table></div>"
      );
    }

    return "";
  }

  function renderInlineMarkdown(rawText) {
    var text = escapeHtml(cleanInlineArtifacts(rawText));

    var codeTokens = [];
    text = text.replace(/`([^`\n]+)`/g, function (_, codeText) {
      var token = "%%INLINE_CODE_" + codeTokens.length + "%%";
      codeTokens.push("<code>" + codeText + "</code>");
      return token;
    });

    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, label, url) {
      var safeUrl = sanitizeUrl(url);
      if (!safeUrl) {
        return label;
      }
      return '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });

    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");

    text = text.replace(/(^|[^\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
    text = text.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");

    text = text.replace(/(^|[\s>])\*(?=[\s<]|$)/g, "$1");
    text = text.replace(/\*\*(?=[\s<]|$)/g, "");
    text = text.replace(/__(?=[\s<]|$)/g, "");
    text = text.replace(/(^|[\s>])_(?=[\s<]|$)/g, "$1");

    for (var i = 0; i < codeTokens.length; i += 1) {
      text = text.replace("%%INLINE_CODE_" + i + "%%", codeTokens[i]);
    }

    return text.replace(/\n/g, "<br>");
  }

  function cleanInlineArtifacts(value) {
    var text = String(value == null ? "" : value);
    text = text.replace(/\s+\*\s+/g, " ");
    text = text.replace(/(^|\s)\*(?=\s|$)/g, "$1");
    return text;
  }

  function sanitizeUrl(url) {
    var normalized = String(url || "").replace(/&amp;/g, "&").trim();
    if (!/^https?:\/\//i.test(normalized)) {
      return "";
    }
    return escapeAttribute(normalized);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/\"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function splitTableRow(line) {
    var text = String(line || "").trim();
    if (text.startsWith("|")) {
      text = text.slice(1);
    }
    if (text.endsWith("|")) {
      text = text.slice(0, -1);
    }
    return text.split("|").map(function (cell) {
      return cell.trim();
    });
  }

  function isTableStart(lines, index) {
    if (index + 1 >= lines.length) {
      return false;
    }

    var headerLine = lines[index];
    var dividerLine = lines[index + 1].trim();

    if (!headerLine || headerLine.indexOf("|") === -1) {
      return false;
    }

    return /^\|?\s*[:\-\s|]+\|?\s*$/.test(dividerLine) && dividerLine.indexOf("-") !== -1;
  }

  function isBlank(line) {
    return /^\s*$/.test(line || "");
  }

  function isFenceStart(line) {
    return /^\s*```/.test(line || "");
  }

  function isHeadingLine(line) {
    return /^\s{0,3}#{1,6}\s+/.test(line || "");
  }

  function isBlockQuoteLine(line) {
    return /^\s*>\s?/.test(line || "");
  }

  function isUnorderedListLine(line) {
    return /^\s*[-+*]\s+/.test(line || "");
  }

  function isOrderedListLine(line) {
    return /^\s*\d+[.)]\s+/.test(line || "");
  }
})();
