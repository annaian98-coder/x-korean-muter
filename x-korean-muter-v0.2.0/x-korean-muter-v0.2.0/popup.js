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

const $ = (id) => document.getElementById(id);
const ruleValue = $('ruleValue');
const ruleMode = $('ruleMode');
const ruleTarget = $('ruleTarget');
const ruleList = $('ruleList');
const emptyState = $('emptyState');
const ruleCount = $('ruleCount');
const status = $('status');

const MODE_LABELS = {
  aggressive: '우회 표기 포함',
  contains: '부분 포함',
  exact: '정확히 일치',
  regex: '정규식'
};

const TARGET_LABELS = {
  text: '글 내용',
  username: '사용자명',
  all: '내용 + 사용자명'
};

function uid() {
  return `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`;
}

function showStatus(message) {
  status.textContent = message;
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => status.textContent = '', 1600);
}

async function save() {
  await chrome.storage.local.set({ xkmSettings: settings });
}

function renderRules() {
  ruleList.textContent = '';
  ruleCount.textContent = `${settings.rules.length}개`;
  emptyState.hidden = settings.rules.length > 0;

  settings.rules.forEach(rule => {
    const row = document.createElement('div');
    row.className = 'rule';

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = rule.enabled !== false;
    enabled.title = '규칙 사용';
    enabled.addEventListener('change', async () => {
      rule.enabled = enabled.checked;
      await save();
      showStatus('저장했습니다.');
    });

    const main = document.createElement('div');
    main.className = 'rule-main';

    const value = document.createElement('div');
    value.className = 'rule-value';
    value.textContent = rule.value;

    const meta = document.createElement('div');
    meta.className = 'rule-meta';
    meta.textContent = `${MODE_LABELS[rule.mode] || rule.mode} · ${TARGET_LABELS[rule.target] || rule.target}`;

    main.append(value, meta);

    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = '삭제';
    del.addEventListener('click', async () => {
      settings.rules = settings.rules.filter(x => x.id !== rule.id);
      await save();
      renderRules();
      showStatus('삭제했습니다.');
    });

    row.append(enabled, main, del);
    ruleList.append(row);
  });
}

function syncControls() {
  document.querySelectorAll('input[name="hideMode"]').forEach(input => {
    input.checked = input.value === settings.hideMode;
  });
  $('surfaceTweets').checked = !!settings.surfaces.tweets;
  $('surfaceUsernames').checked = !!settings.surfaces.usernames;
  $('surfaceProfiles').checked = !!settings.surfaces.profiles;
  $('surfaceTrends').checked = !!settings.surfaces.trends;
  $('surfaceSearch').checked = !!settings.surfaces.search;
}

async function load() {
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
  } else if (Array.isArray(stored.mutedWords) && stored.mutedWords.length) {
    settings.rules = stored.mutedWords.map(value => ({
      id: uid(),
      value,
      mode: 'contains',
      target: 'text',
      enabled: true
    }));
    await save();
  }
  renderRules();
  syncControls();
}

$('addRule').addEventListener('click', async () => {
  const value = ruleValue.value.trim();
  if (!value) {
    showStatus('단어를 입력해 주세요.');
    return;
  }

  if (ruleMode.value === 'regex') {
    try {
      new RegExp(value, 'iu');
    } catch {
      showStatus('정규식 형식이 올바르지 않습니다.');
      return;
    }
  }

  settings.rules.unshift({
    id: uid(),
    value,
    mode: ruleMode.value,
    target: ruleTarget.value,
    enabled: true
  });

  await save();
  ruleValue.value = '';
  renderRules();
  showStatus('추가했습니다.');
});

ruleValue.addEventListener('keydown', event => {
  if (event.key === 'Enter') $('addRule').click();
});

document.querySelectorAll('input[name="hideMode"]').forEach(input => {
  input.addEventListener('change', async () => {
    if (!input.checked) return;
    settings.hideMode = input.value;
    await save();
    showStatus('표시 방식을 저장했습니다.');
  });
});

[
  ['surfaceTweets', 'tweets'],
  ['surfaceUsernames', 'usernames'],
  ['surfaceProfiles', 'profiles'],
  ['surfaceTrends', 'trends'],
  ['surfaceSearch', 'search']
].forEach(([id, key]) => {
  $(id).addEventListener('change', async event => {
    settings.surfaces[key] = event.target.checked;
    await save();
    showStatus('검사 범위를 저장했습니다.');
  });
});

$('exportBtn').addEventListener('click', async () => {
  const payload = {
    app: 'X Korean Word Muter',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `x-korean-muter-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showStatus('설정을 내보냈습니다.');
});

$('importBtn').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());
    const incoming = data.settings || data;
    if (!incoming || !Array.isArray(incoming.rules)) throw new Error('invalid');

    settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...incoming,
      surfaces: {
        ...DEFAULT_SETTINGS.surfaces,
        ...(incoming.surfaces || {})
      },
      rules: incoming.rules
        .filter(rule => rule && typeof rule.value === 'string')
        .map(rule => ({
          id: rule.id || uid(),
          value: rule.value,
          mode: ['aggressive', 'contains', 'exact', 'regex'].includes(rule.mode) ? rule.mode : 'aggressive',
          target: ['text', 'username', 'all'].includes(rule.target) ? rule.target : 'text',
          enabled: rule.enabled !== false
        }))
    };

    await save();
    renderRules();
    syncControls();
    showStatus('설정을 가져왔습니다.');
  } catch {
    showStatus('가져올 수 없는 설정 파일입니다.');
  } finally {
    event.target.value = '';
  }
});

load();
