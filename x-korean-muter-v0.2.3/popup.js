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
let editingRuleId = null;

const $ = (id) => document.getElementById(id);
const ruleValue = $('ruleValue');
const ruleMode = $('ruleMode');
const ruleTarget = $('ruleTarget');
const ruleList = $('ruleList');
const emptyState = $('emptyState');
const ruleCount = $('ruleCount');
const status = $('status');
const addRuleButton = $('addRule');
const cancelEditButton = $('cancelEdit');
const editNotice = $('editNotice');
const modeHint = $('modeHint');

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

const MODE_DESCRIPTIONS = {
  aggressive: '공백·구두점·기호·제로폭 문자를 제거한 뒤 비교합니다. 예: “고양이” 등록 시 “고 양 이”, “고.양.이”도 뮤트됩니다.',
  contains: '입력한 글자가 원문에 연속해서 포함되어 있으면 뮤트합니다. 예: “스포” 등록 시 “스포주의”, “영화스포”가 뮤트됩니다.',
  exact: '검사 대상 전체가 입력한 내용과 정확히 같을 때만 뮤트합니다. 예: “고양이”는 뮤트하지만 “고양이 사진”은 뮤트하지 않습니다.',
  regex: '정규식을 직접 사용해 원하는 패턴을 지정합니다. 예: “고[\\s._-]*양[\\s._-]*이”처럼 우회 표기를 세밀하게 지정할 수 있습니다.'
};

function updateModeHint() {
  modeHint.textContent = MODE_DESCRIPTIONS[ruleMode.value] || '';
}

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

    const buttons = document.createElement('div');
    buttons.className = 'rule-buttons';

    const edit = document.createElement('button');
    edit.className = 'edit';
    edit.textContent = '수정';
    edit.addEventListener('click', () => {
      editingRuleId = rule.id;
      ruleValue.value = rule.value;
      ruleMode.value = rule.mode || 'aggressive';
      updateModeHint();
      ruleTarget.value = rule.target || 'text';
      addRuleButton.textContent = '수정 저장';
      cancelEditButton.hidden = false;
      editNotice.hidden = false;
      ruleValue.focus();
      ruleValue.select();
      showStatus('수정할 내용을 변경한 뒤 저장해 주세요.');
    });

    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = '삭제';
    del.addEventListener('click', async () => {
      settings.rules = settings.rules.filter(x => x.id !== rule.id);
      if (editingRuleId === rule.id) resetEditor();
      await save();
      renderRules();
      showStatus('삭제했습니다.');
    });

    buttons.append(edit, del);
    row.append(enabled, main, buttons);
    ruleList.append(row);
  });
}

function resetEditor() {
  editingRuleId = null;
  ruleValue.value = '';
  ruleMode.value = 'aggressive';
  updateModeHint();
  ruleTarget.value = 'text';
  addRuleButton.textContent = '추가';
  cancelEditButton.hidden = true;
  editNotice.hidden = true;
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

addRuleButton.addEventListener('click', async () => {
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

  if (editingRuleId) {
    const rule = settings.rules.find(x => x.id === editingRuleId);
    if (!rule) {
      resetEditor();
      showStatus('수정할 규칙을 찾을 수 없습니다.');
      return;
    }

    rule.value = value;
    rule.mode = ruleMode.value;
    rule.target = ruleTarget.value;
    await save();
    resetEditor();
    renderRules();
    showStatus('수정했습니다.');
    return;
  }

  settings.rules.unshift({
    id: uid(),
    value,
    mode: ruleMode.value,
    target: ruleTarget.value,
    enabled: true
  });

  await save();
  resetEditor();
  renderRules();
  showStatus('추가했습니다.');
});

cancelEditButton.addEventListener('click', () => {
  resetEditor();
  showStatus('수정을 취소했습니다.');
});

ruleMode.addEventListener('change', updateModeHint);

ruleValue.addEventListener('keydown', event => {
  if (event.key === 'Enter') addRuleButton.click();
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

updateModeHint();
load();
