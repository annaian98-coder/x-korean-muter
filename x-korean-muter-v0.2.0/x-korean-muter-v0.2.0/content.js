const CONFIG = {
  selectors: {
    tweet: 'article[data-testid="tweet"]',
    tweetText: '[data-testid="tweetText"]',
    userName: '[data-testid="User-Name"]',
    userCell: '[data-testid="UserCell"]',
    trend: '[data-testid="trend"]',
    primaryColumn: '[data-testid="primaryColumn"]'
  },
  attrs: {
    processed: 'data-xkm-processed'
  }
};

const DEFAULT_SETTINGS = {
  rules: [],
  hideMode: 'collapse',
  surfaces: {
    tweets: true,
    usernames: true,
    profiles: true,
    trends: true,
    search: true
  }
};

let settings = structuredClone(DEFAULT_SETTINGS);
let observer = null;
let scanQueued = false;

function normalizeBasic(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .trim();
}

function normalizeAggressive(value) {
  return normalizeBasic(value)
    .replace(/[\s\p{P}\p{S}\p{Cf}]+/gu, '');
}

function compileRule(rule) {
  if (!rule || rule.enabled === false || !String(rule.value ?? '').trim()) return null;

  const value = String(rule.value).trim();
  const mode = rule.mode || 'aggressive';

  if (mode === 'regex') {
    try {
      return { ...rule, value, regex: new RegExp(value, 'iu') };
    } catch {
      return null;
    }
  }
  return { ...rule, value };
}

function ruleMatches(text, rule) {
  const compiled = compileRule(rule);
  if (!compiled) return false;

  const source = String(text ?? '');
  const mode = compiled.mode || 'aggressive';

  if (mode === 'exact') {
    return normalizeBasic(source) === normalizeBasic(compiled.value);
  }
  if (mode === 'contains') {
    return normalizeBasic(source).includes(normalizeBasic(compiled.value));
  }
  if (mode === 'aggressive') {
    const needle = normalizeAggressive(compiled.value);
    return needle.length > 0 && normalizeAggressive(source).includes(needle);
  }
  if (mode === 'regex') {
    return compiled.regex.test(source);
  }
  return false;
}

function matchingRule(text, target) {
  return settings.rules.find(rule => {
    if (rule.enabled === false) return false;
    const ruleTarget = rule.target || 'text';
    if (ruleTarget !== target && ruleTarget !== 'all') return false;
    return ruleMatches(text, rule);
  });
}

function getText(el) {
  return (el?.innerText || el?.textContent || '').trim();
}

function getTweetText(tweet) {
  // 인용 게시물도 동일 article 내부의 tweetText 노드로 들어오는 경우 함께 합산합니다.
  return Array.from(tweet.querySelectorAll(CONFIG.selectors.tweetText))
    .map(getText)
    .filter(Boolean)
    .join('\n');
}

function getTweetUserText(tweet) {
  const user = tweet.querySelector(CONFIG.selectors.userName);
  return getText(user);
}

function clearMute(el) {
  el.classList.remove('xkm-hidden', 'xkm-collapsed');
  el.removeAttribute('data-xkm-reason');
  el.querySelector(':scope > .xkm-placeholder')?.remove();
}

function addPlaceholder(el, rule, reason) {
  if (el.querySelector(':scope > .xkm-placeholder')) return;

  const placeholder = document.createElement('div');
  placeholder.className = 'xkm-placeholder';

  const message = document.createElement('span');
  message.className = 'xkm-message';
  message.textContent = `뮤트됨 · ${reason}${rule?.value ? ` · ${rule.value}` : ''}`;

  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.className = 'xkm-reveal';
  reveal.textContent = '게시물 보기';
  reveal.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    el.classList.remove('xkm-collapsed');
    placeholder.remove();
  });

  placeholder.append(message, reveal);
  el.prepend(placeholder);
}

function applyMute(el, rule, reason) {
  clearMute(el);
  el.setAttribute('data-xkm-reason', reason);

  if (settings.hideMode === 'hidden') {
    el.classList.add('xkm-hidden');
  } else {
    el.classList.add('xkm-collapsed');
    addPlaceholder(el, rule, reason);
  }
}

function processTweet(tweet) {
  if (!(tweet instanceof Element)) return;
  clearMute(tweet);

  if (!settings.surfaces.tweets && !settings.surfaces.usernames) return;

  if (settings.surfaces.usernames) {
    const userText = getTweetUserText(tweet);
    const userRule = matchingRule(userText, 'username');
    if (userRule) {
      applyMute(tweet, userRule, '사용자명');
      return;
    }
  }

  if (settings.surfaces.tweets) {
    const text = getTweetText(tweet);
    const textRule = matchingRule(text, 'text');
    if (textRule) {
      applyMute(tweet, textRule, '게시물');
      return;
    }
  }
}

function processUserCell(cell) {
  if (!settings.surfaces.profiles || !(cell instanceof Element)) return;
  clearMute(cell);
  const rule = matchingRule(getText(cell), 'username') || matchingRule(getText(cell), 'text');
  if (rule) applyMute(cell, rule, '프로필/사용자');
}

function processTrend(trend) {
  if (!settings.surfaces.trends || !(trend instanceof Element)) return;
  clearMute(trend);
  const rule = matchingRule(getText(trend), 'text');
  if (rule) applyMute(trend, rule, '트렌드');
}

function processProfileBio() {
  if (!settings.surfaces.profiles) return;

  // 프로필 화면에서 bio는 비교적 안정적인 testid를 가지는 경우가 많지만,
  // X 변경에 대비해 여러 후보를 사용합니다.
  const candidates = document.querySelectorAll(
    '[data-testid="UserDescription"], [data-testid="UserName"], [data-testid="UserProfileHeader_Items"]'
  );

  candidates.forEach(el => {
    clearMute(el);
    const text = getText(el);
    const rule = matchingRule(text, 'text') || matchingRule(text, 'username');
    if (rule) applyMute(el, rule, '프로필');
  });
}

function scan(root = document) {
  const scope = root instanceof Element || root instanceof Document ? root : document;

  if (root instanceof Element && root.matches(CONFIG.selectors.tweet)) processTweet(root);
  scope.querySelectorAll?.(CONFIG.selectors.tweet).forEach(processTweet);

  if (root instanceof Element && root.matches(CONFIG.selectors.userCell)) processUserCell(root);
  scope.querySelectorAll?.(CONFIG.selectors.userCell).forEach(processUserCell);

  if (root instanceof Element && root.matches(CONFIG.selectors.trend)) processTrend(root);
  scope.querySelectorAll?.(CONFIG.selectors.trend).forEach(processTrend);

  processProfileBio();
}

function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    scan(document);
  });
}

async function migrateAndLoad() {
  const stored = await chrome.storage.local.get(['xkmSettings', 'mutedWords']);
  if (stored.xkmSettings) {
    settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...stored.xkmSettings,
      surfaces: {
        ...DEFAULT_SETTINGS.surfaces,
        ...(stored.xkmSettings.surfaces || {})
      },
      rules: Array.isArray(stored.xkmSettings.rules) ? stored.xkmSettings.rules : []
    };
    return;
  }

  // v0.1.x 데이터 자동 마이그레이션
  const oldWords = Array.isArray(stored.mutedWords) ? stored.mutedWords : [];
  if (oldWords.length) {
    settings.rules = oldWords.map((value, index) => ({
      id: `legacy-${Date.now()}-${index}`,
      value,
      mode: 'contains',
      target: 'text',
      enabled: true
    }));
    await chrome.storage.local.set({ xkmSettings: settings });
  }
}

async function init() {
  await migrateAndLoad();
  scan(document);

  observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.xkmSettings) return;
    settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...(changes.xkmSettings.newValue || {}),
      surfaces: {
        ...DEFAULT_SETTINGS.surfaces,
        ...((changes.xkmSettings.newValue || {}).surfaces || {})
      }
    };
    queueScan();
  });

  // X는 SPA이므로 주소 변경 이후에도 다시 검사합니다.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      queueScan();
    }
  }, 1000);
}

init();
