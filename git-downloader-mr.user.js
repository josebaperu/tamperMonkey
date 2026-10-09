// ==UserScript==
// @name         GitLab Download Merge Request
// @namespace    local.git-downloader-mr
// @version      1.0.0
// @description  Download the open GitLab merge request as HTML or Markdown
// @match        https://*/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

// @match and @connect are wide because those headers are fixed text and cannot
// read git_ui_url_organization. The script does nothing unless the page URL
// starts with https:// plus that variable.

(function () {
    'use strict';

    // Edit this before use. Host, or host plus a path. Scheme and trailing slash are optional.
    // The page URL must start with https:// plus this value.
    // Example: git.example.com
    // Example limited to one group: git.example.com/my-group
    var git_ui_url_organization = 'YOUR_GITLAB_HOST';

    var BAR_ID = 'tm-git-mr-download-bar';
    var PLACEHOLDER_ORG = 'YOUR_GITLAB_HOST';
    var MAX_DIFF_FILE = 20000;
    var MAX_DIFF_TOTAL = 400000;

    function normalizeOrg(value) {
        return String(value == null ? '' : value)
            .trim()
            .replace(/^https?:\/\//i, '')
            .replace(/\/+$/, '');
    }

    function orgConfigured(value) {
        var org = normalizeOrg(value == null ? git_ui_url_organization : value);
        return !!org && org !== PLACEHOLDER_ORG;
    }

    // True when href starts with https://${git_ui_url_organization} on a host/path boundary.
    function startsWithOrg(href, orgValue) {
        var org = normalizeOrg(orgValue == null ? git_ui_url_organization : orgValue);
        if (!org) return false;
        var prefix = 'https://' + org;
        var text = String(href || '');
        if (text.indexOf(prefix) !== 0) return false;
        var next = text.charAt(prefix.length);
        return !next || next === '/' || next === '?' || next === '#';
    }

    function safeDecode(value) {
        try {
            return decodeURIComponent(value);
        } catch (e) {
            return value;
        }
    }

    function mrFromUrl(href, orgValue) {
        if (!startsWithOrg(href, orgValue)) return null;
        var url;
        try {
            url = new URL(href);
        } catch (e) {
            return null;
        }
        var path = url.pathname || '';
        var match = path.match(/^(.*)\/-\/merge_requests\/(\d+)(?:\/|$|\.)/);
        if (!match) match = path.match(/^(.*)\/merge_requests\/(\d+)(?:\/|$|\.)/);
        if (!match) return null;
        var projectPath = safeDecode(match[1].replace(/^\/+/, ''));
        if (!projectPath || projectPath === '-') return null;
        return {
            projectPath: projectPath,
            iid: match[2],
            origin: url.origin
        };
    }

    function headerValue(headers, name) {
        var lines = String(headers || '').split(/\r?\n/);
        var wanted = String(name || '').toLowerCase();
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var idx = line.indexOf(':');
            if (idx === -1) continue;
            if (line.slice(0, idx).trim().toLowerCase() === wanted) return line.slice(idx + 1).trim();
        }
        return '';
    }

    function csrfToken() {
        try {
            var meta = document.querySelector('meta[name="csrf-token"]');
            return meta ? (meta.getAttribute('content') || '') : '';
        } catch (e) {
            return '';
        }
    }

    function gmRequest(method, url, body) {
        return new Promise(function (resolve, reject) {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('GM_xmlhttpRequest is not available'));
                return;
            }
            var headers = { 'Accept': 'application/json' };
            var options = {
                method: method,
                url: url,
                timeout: 30000,
                headers: headers,
                onload: function (res) {
                    var status = res && res.status;
                    if (status >= 200 && status < 300) {
                        try {
                            resolve({
                                json: JSON.parse(res.responseText),
                                headers: (res && res.responseHeaders) || ''
                            });
                        } catch (e) {
                            reject(new Error('response was not JSON'));
                        }
                        return;
                    }
                    var err = new Error('HTTP ' + status);
                    err.status = status;
                    reject(err);
                },
                onerror: function () {
                    reject(new Error('request failed'));
                },
                ontimeout: function () {
                    reject(new Error('request timed out'));
                }
            };
            if (body != null) {
                headers['Content-Type'] = 'application/json';
                var token = csrfToken();
                if (token) headers['X-CSRF-Token'] = token;
                headers['X-Requested-With'] = 'XMLHttpRequest';
                options.data = JSON.stringify(body);
            }
            GM_xmlhttpRequest(options);
        });
    }

    function gmGet(url) {
        return gmRequest('GET', url).then(function (res) { return res.json; });
    }

    function withPage(url, pageNum) {
        var parsed = new URL(url);
        parsed.searchParams.set('page', String(pageNum));
        return parsed.href;
    }

    function fetchAllPages(firstUrl) {
        var all = [];
        function page(url, guard) {
            return gmRequest('GET', url).then(function (res) {
                var batch = Array.isArray(res.json) ? res.json : [];
                for (var i = 0; i < batch.length; i++) all.push(batch[i]);
                var next = headerValue(res.headers, 'x-next-page');
                if (!next || !batch.length || guard > 50) return all;
                return page(withPage(url, next), guard + 1);
            });
        }
        return page(firstUrl, 0);
    }

    function fetchDiffs(base) {
        return fetchAllPages(base + '/diffs?per_page=100').catch(function (err) {
            if (!err || err.status !== 404) throw err;
            return gmGet(base + '/changes').then(function (data) {
                return (data && data.changes) || [];
            });
        });
    }

    function soft(promise, label) {
        return promise.then(function (value) {
            return { ok: true, value: value };
        }).catch(function (err) {
            console.log('[GIT-MR] ' + label + ' failed', err);
            return { ok: false, value: null };
        });
    }

    function messageFor(err) {
        var status = err && err.status;
        if (status === 401 || status === 403) return 'session could not read the merge request';
        if (status === 404) return 'unknown merge request';
        if (err && err.message) return err.message;
        return 'download failed';
    }

    function personName(user) {
        if (!user) return '';
        var name = user.name || user.displayName || '';
        var username = user.username || '';
        if (name && username) return name + ' (@' + username + ')';
        if (username) return '@' + username;
        return name || user.email || '';
    }

    function peopleList(list, single) {
        var source = Array.isArray(list) && list.length ? list : (single ? [single] : []);
        var out = [];
        for (var i = 0; i < source.length; i++) {
            var name = personName(source[i]);
            if (name) out.push(name);
        }
        return out;
    }

    function humanToken(value) {
        return String(value || '').replace(/_/g, ' ');
    }

    function mapNote(note) {
        var pos = note && note.position;
        var file = '';
        var line = '';
        if (pos) {
            file = pos.new_path || pos.old_path || '';
            if (pos.new_line) line = String(pos.new_line);
            else if (pos.old_line) line = String(pos.old_line);
        }
        return {
            author: personName(note && note.author) || 'Unknown',
            created: (note && note.created_at) || '',
            body: (note && note.body) || '',
            html: '',
            system: !!(note && note.system),
            file: file,
            line: line,
            resolved: note && note.resolvable ? !!note.resolved : null
        };
    }

    function mapCommit(commit) {
        var id = (commit && (commit.short_id || commit.id)) || '';
        return {
            shortId: String(id).slice(0, 8),
            title: (commit && commit.title) || '',
            author: (commit && commit.author_name) || '',
            created: (commit && (commit.authored_date || commit.created_at)) || ''
        };
    }

    function fileStatus(file) {
        if (!file) return 'modified';
        if (file.new_file) return 'added';
        if (file.deleted_file) return 'deleted';
        if (file.renamed_file) return 'renamed';
        return 'modified';
    }

    function mapDiff(file) {
        return {
            oldPath: (file && file.old_path) || '',
            newPath: (file && file.new_path) || '',
            status: fileStatus(file),
            diff: (file && file.diff) || ''
        };
    }

    function mapList(list, mapper) {
        var out = [];
        if (!Array.isArray(list)) return out;
        for (var i = 0; i < list.length; i++) out.push(mapper(list[i]));
        return out;
    }

    function approvedNames(approvals) {
        var rows = approvals && approvals.approved_by;
        var out = [];
        if (!Array.isArray(rows)) return out;
        for (var i = 0; i < rows.length; i++) {
            var entry = rows[i] || {};
            var name = personName(entry.user || entry);
            if (name) out.push(name);
        }
        return out;
    }

    function stateLabel(mr) {
        var state = (mr && mr.state) || '';
        if (mr && (mr.draft || mr.work_in_progress)) return state ? 'draft (' + state + ')' : 'draft';
        return state;
    }

    function pipelineLabel(pipeline) {
        if (!pipeline || !pipeline.status) return '';
        var label = humanToken(pipeline.status);
        if (pipeline.web_url) label += ' ' + pipeline.web_url;
        return label;
    }

    function toSnapshot(mr, notesResult, commitsResult, diffsResult, approvalsResult, context) {
        var data = mr || {};
        var ctx = context || {};
        var projectPath = ctx.projectPath || '';
        var iid = String(data.iid || ctx.iid || '');
        var origin = ctx.origin || '';
        var reference = projectPath && iid ? projectPath + '!' + iid : (iid ? '!' + iid : '');
        var webUrl = data.web_url || '';
        if (!webUrl && origin && projectPath && iid) {
            webUrl = origin + '/' + projectPath + '/-/merge_requests/' + iid;
        }
        var timeStats = data.time_stats || {};
        var votes = '';
        var up = Number(data.upvotes) || 0;
        var down = Number(data.downvotes) || 0;
        if (up || down) votes = '+' + up + ' / -' + down;
        var notesOk = !!(notesResult && notesResult.ok);
        var commitsOk = !!(commitsResult && commitsResult.ok);
        var diffsOk = !!(diffsResult && diffsResult.ok);
        return {
            reference: reference,
            iid: iid,
            projectPath: projectPath,
            url: webUrl,
            fetchedAt: new Date().toISOString(),
            title: data.title || '',
            description: data.description || '',
            descriptionHtml: '',
            state: stateLabel(data),
            author: personName(data.author),
            assignees: peopleList(data.assignees, data.assignee),
            reviewers: peopleList(data.reviewers),
            approvedBy: approvedNames(approvalsResult && approvalsResult.ok ? approvalsResult.value : null),
            labels: Array.isArray(data.labels) ? data.labels.slice() : [],
            milestone: data.milestone ? (data.milestone.title || '') : '',
            sourceBranch: data.source_branch || '',
            targetBranch: data.target_branch || '',
            created: data.created_at || '',
            updated: data.updated_at || '',
            merged: data.merged_at || '',
            closed: data.closed_at || '',
            mergeStatus: humanToken(data.detailed_merge_status || data.merge_status || ''),
            sha: data.sha || '',
            pipeline: pipelineLabel(data.head_pipeline),
            timeEstimate: timeStats.human_time_estimate || '',
            timeSpent: timeStats.human_total_time_spent || '',
            votes: votes,
            notes: notesOk ? mapList(notesResult.value, mapNote) : [],
            notesLoaded: notesOk,
            commits: commitsOk ? mapList(commitsResult.value, mapCommit) : [],
            commitsLoaded: commitsOk,
            diffs: diffsOk ? mapList(diffsResult.value, mapDiff) : [],
            diffsLoaded: diffsOk
        };
    }

    function apiBase(mr) {
        return mr.origin + '/api/v4/projects/' + encodeURIComponent(mr.projectPath) +
            '/merge_requests/' + encodeURIComponent(mr.iid);
    }

    function fillRenderedHtml(origin, projectPath, snap) {
        var markdownApiDown = false;
        function renderText(text) {
            if (markdownApiDown || !text || !String(text).trim()) return Promise.resolve('');
            return gmRequest('POST', origin + '/api/v4/markdown', {
                text: String(text),
                gfm: true,
                project: projectPath
            }).then(function (res) {
                return (res.json && res.json.html) || '';
            }).catch(function (err) {
                var status = err && err.status;
                if (status === 401 || status === 403 || status === 404) markdownApiDown = true;
                console.log('[GIT-MR] markdown render failed', err);
                return '';
            });
        }
        return renderText(snap.description).then(function (html) {
            snap.descriptionHtml = html;
            var indexes = [];
            for (var i = 0; i < snap.notes.length; i++) {
                if (!snap.notes[i].system && snap.notes[i].body) indexes.push(i);
            }
            return mapPool(indexes, 4, function (index) {
                return renderText(snap.notes[index].body).then(function (noteHtml) {
                    snap.notes[index].html = noteHtml;
                });
            }).then(function () { return snap; });
        });
    }

    function mapPool(items, limit, fn) {
        var nextIndex = 0;
        function worker() {
            if (nextIndex >= items.length) return Promise.resolve();
            var current = nextIndex;
            nextIndex += 1;
            return Promise.resolve()
                .then(function () { return fn(items[current], current); })
                .then(worker);
        }
        var workers = [];
        var count = Math.min(limit, items.length);
        for (var i = 0; i < count; i++) workers.push(worker());
        if (!workers.length) return Promise.resolve();
        return Promise.all(workers);
    }

    function fetchSnapshot(mr, wantHtml) {
        var base = apiBase(mr);
        return gmGet(base).then(function (data) {
            return Promise.all([
                soft(fetchAllPages(base + '/notes?per_page=100&sort=asc&order_by=created_at'), 'notes'),
                soft(fetchAllPages(base + '/commits?per_page=100'), 'commits'),
                soft(fetchDiffs(base), 'diffs'),
                soft(gmGet(base + '/approvals'), 'approvals')
            ]).then(function (parts) {
                var snap = toSnapshot(data, parts[0], parts[1], parts[2], parts[3], mr);
                if (!wantHtml) return snap;
                return fillRenderedHtml(mr.origin, mr.projectPath, snap).catch(function (err) {
                    console.log('[GIT-MR] HTML render skipped', err);
                    return snap;
                });
            });
        });
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function stripDangerous(root) {
        if (!root || !root.querySelectorAll) return;
        var blocked = root.querySelectorAll('script, iframe, object, embed, link, meta, base');
        for (var i = blocked.length - 1; i >= 0; i--) blocked[i].remove();
        var all = root.querySelectorAll('*');
        for (var j = 0; j < all.length; j++) stripAttrs(all[j]);
    }

    function stripAttrs(el) {
        if (!el || !el.attributes) return;
        for (var i = el.attributes.length - 1; i >= 0; i--) {
            var attr = el.attributes[i];
            var name = attr.name.toLowerCase();
            var value = attr.value || '';
            if (name.indexOf('on') === 0) {
                el.removeAttribute(attr.name);
            } else if ((name === 'href' || name === 'src') && unsafeUrl(value)) {
                el.removeAttribute(attr.name);
            }
        }
    }

    function unsafeUrl(value) {
        var text = String(value).replace(/^\s+/, '');
        if (/^javascript:/i.test(text)) return true;
        if (/^data:/i.test(text) && !/^data:image\//i.test(text)) return true;
        return false;
    }

    function absolutizeElement(el, origin) {
        if (!el || !origin) return;
        ['href', 'src'].forEach(function (name) {
            if (!el.getAttribute) return;
            var value = el.getAttribute(name);
            if (!value) return;
            var text = String(value).replace(/^\s+/, '');
            if (text.charAt(0) === '/' && text.charAt(1) !== '/') el.setAttribute(name, origin + text);
        });
    }

    function sanitizeHtml(html, origin) {
        if (!html) return '';
        if (typeof DOMParser === 'undefined') return '';
        var doc = new DOMParser().parseFromString(String(html), 'text/html');
        stripDangerous(doc);
        stripAttrs(doc.body);
        if (origin && doc.body.querySelectorAll) {
            var linked = doc.body.querySelectorAll('[href], [src]');
            for (var i = 0; i < linked.length; i++) absolutizeElement(linked[i], origin);
        }
        return doc.body.innerHTML;
    }

    function formatWhen(value) {
        var date = parseWhen(value);
        if (!date) return value ? String(value) : '';
        return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    }

    function parseWhen(value) {
        if (!value) return null;
        var normalized = String(value).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
        var date = new Date(normalized);
        if (isNaN(date.getTime())) return null;
        return date;
    }

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function fileStamp(date) {
        return date.getFullYear() +
            pad2(date.getMonth() + 1) +
            pad2(date.getDate()) + '_' +
            pad2(date.getHours()) +
            pad2(date.getMinutes());
    }

    function safeToken(value) {
        return String(value || '')
            .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 100);
    }

    // project_path_MR<iid>_YYYYMMDD_HHMM from the merge request's updated time, in local time.
    function downloadBaseName(snap) {
        var project = safeToken(snap && snap.projectPath) || 'project';
        var iid = String((snap && snap.iid) || 'mr').replace(/[^\w.-]+/g, '');
        var date = parseWhen(snap && snap.updated) || parseWhen(snap && snap.fetchedAt) || new Date();
        return project + '_MR' + iid + '_' + fileStamp(date);
    }

    function downloadDir(kind) {
        return kind === 'md' ? 'gitMD' : 'gitHtml';
    }

    function joinList(list) {
        if (!list || !list.length) return '';
        return list.join(', ');
    }

    function metaRows(snap) {
        return [
            ['Project', snap.projectPath],
            ['State', snap.state],
            ['Author', snap.author],
            ['Assignees', joinList(snap.assignees)],
            ['Reviewers', joinList(snap.reviewers)],
            ['Approved by', joinList(snap.approvedBy)],
            ['Source branch', snap.sourceBranch],
            ['Target branch', snap.targetBranch],
            ['Labels', joinList(snap.labels)],
            ['Milestone', snap.milestone],
            ['Created', formatWhen(snap.created)],
            ['Updated', formatWhen(snap.updated)],
            ['Merged', formatWhen(snap.merged)],
            ['Closed', formatWhen(snap.closed)],
            ['Merge status', snap.mergeStatus],
            ['Head SHA', snap.sha],
            ['Pipeline', snap.pipeline],
            ['Time estimate', snap.timeEstimate],
            ['Time spent', snap.timeSpent],
            ['Votes', snap.votes]
        ];
    }

    function filledRows(snap) {
        var rows = metaRows(snap);
        var out = [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i][1]) out.push(rows[i]);
        }
        return out;
    }

    function originOf(snap) {
        try {
            return snap && snap.url ? new URL(snap.url).origin : '';
        } catch (e) {
            return '';
        }
    }

    function richHtml(html, markdown, origin) {
        var clean = html ? sanitizeHtml(html, origin) : '';
        if (clean && String(clean).trim()) return clean;
        if (markdown && String(markdown).trim()) return '<pre>' + escapeHtml(markdown) + '</pre>';
        return '';
    }

    function noteLocation(note) {
        if (!note || !note.file) return '';
        return note.file + (note.line ? ':' + note.line : '');
    }

    function resolvedLabel(note) {
        if (!note || note.resolved == null) return '';
        return note.resolved ? 'resolved' : 'unresolved';
    }

    var CSS = [
        'body { margin: 0; background: #fafaf7; color: #1c1c1c; font: 16px/1.5 Georgia, "Iowan Old Style", Palatino, serif; }',
        'main { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }',
        '.key, .meta, dl, .source, footer, .file-path { font-family: ui-sans-serif, system-ui, sans-serif; }',
        '.key { margin: 0; letter-spacing: .04em; color: #5c5c5c; font-size: 13px; }',
        'h1 { font-size: 1.75rem; line-height: 1.25; margin: 4px 0 8px; }',
        'h2 { font-size: 1.2rem; margin: 28px 0 8px; }',
        'h3 { font-size: 1rem; margin: 18px 0 6px; }',
        '.source, footer { font-size: 13px; color: #5c5c5c; }',
        'dl { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; font-size: 14px; margin: 16px 0; }',
        'dt { color: #5c5c5c; }',
        'dd { margin: 0; }',
        'table { border-collapse: collapse; width: 100%; margin: 12px 0; }',
        'th, td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; text-align: left; }',
        'th { background: #f0f0ea; }',
        'pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }',
        'pre { background: #f0f0ea; padding: 12px; overflow: auto; white-space: pre-wrap; }',
        'blockquote { border-left: 3px solid #ccc; margin: 12px 0; padding-left: 12px; color: #333; }',
        'img { max-width: 100%; height: auto; }',
        '.note { border-top: 1px solid #e4e4dc; padding: 12px 0; }',
        '.note.system { color: #333; }',
        '.meta { font-size: 13px; color: #5c5c5c; margin: 0 0 8px; }',
        '.file-path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14px; }',
        '.empty { color: #777; font-style: italic; }',
        'a { color: #0b57d0; }',
        'ul, ol { padding-left: 1.4em; }'
    ].join('\n');

    function renderHtml(snap) {
        var origin = originOf(snap);
        var rows = filledRows(snap);
        var meta = '';
        if (rows.length) {
            meta = '<dl>';
            for (var i = 0; i < rows.length; i++) {
                meta += '<dt>' + escapeHtml(rows[i][0]) + '</dt><dd>' + escapeHtml(rows[i][1]) + '</dd>';
            }
            meta += '</dl>';
        }
        var description = richHtml(snap.descriptionHtml, snap.description, origin);
        if (!description) description = '<p class="empty">No description.</p>';
        var heading = (snap.reference ? snap.reference + ' ' : '') + (snap.title || '');
        return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
            '<title>' + escapeHtml(heading || 'Merge request') + '</title>\n<style>\n' + CSS + '\n</style>\n</head>\n<body>\n<main>\n' +
            '<p class="key">' + escapeHtml(snap.reference || '') + '</p>\n' +
            '<h1>' + escapeHtml(snap.title || snap.reference || 'Merge request') + '</h1>\n' +
            (snap.url ? '<p class="source"><a href="' + escapeHtml(snap.url) + '">' + escapeHtml(snap.url) + '</a></p>\n' : '') +
            meta +
            '<h2>Description</h2>\n<div class="description">' + description + '</div>\n' +
            '<h2>Notes</h2>\n' + notesHtml(snap, origin) + '\n' +
            '<h2>Commits</h2>\n' + commitsHtml(snap) + '\n' +
            '<h2>Changes</h2>\n' + changesHtml(snap) + '\n' +
            '<footer>Saved ' + escapeHtml(formatWhen(snap.fetchedAt)) + '</footer>\n' +
            '</main>\n</body>\n</html>\n';
    }

    function notesHtml(snap, origin) {
        if (!snap.notesLoaded) return '<p class="empty">Notes could not be loaded.</p>';
        if (!snap.notes.length) return '<p class="empty">No notes.</p>';
        var html = '';
        for (var i = 0; i < snap.notes.length; i++) {
            var note = snap.notes[i];
            var bits = [note.author || 'Unknown', formatWhen(note.created)];
            var where = noteLocation(note);
            if (where) bits.push(where);
            var resolved = resolvedLabel(note);
            if (resolved) bits.push(resolved);
            if (note.system) bits.push('activity');
            var body = richHtml(note.html, note.body, origin);
            if (!body) body = '<p class="empty">No note body.</p>';
            html += '<article class="note' + (note.system ? ' system' : '') + '"><p class="meta">' +
                escapeHtml(bits.join(' — ')) + '</p>' + body + '</article>';
        }
        return html;
    }

    function commitsHtml(snap) {
        if (!snap.commitsLoaded) return '<p class="empty">Commits could not be loaded.</p>';
        if (!snap.commits.length) return '<p class="empty">No commits.</p>';
        var html = '<ul>';
        for (var i = 0; i < snap.commits.length; i++) {
            var commit = snap.commits[i];
            html += '<li><code>' + escapeHtml(commit.shortId) + '</code> ' + escapeHtml(commit.title || '') +
                extraText(commit.author, formatWhen(commit.created)) + '</li>';
        }
        return html + '</ul>';
    }

    function extraText(author, when) {
        var bits = [];
        if (author) bits.push(author);
        if (when) bits.push(when);
        if (!bits.length) return '';
        return ' <span class="meta">(' + escapeHtml(bits.join(', ')) + ')</span>';
    }

    function fileTitle(file) {
        if (file.status === 'renamed' && file.oldPath && file.newPath && file.oldPath !== file.newPath) {
            return file.oldPath + ' → ' + file.newPath;
        }
        if (file.status === 'deleted') return file.oldPath || file.newPath || 'file';
        return file.newPath || file.oldPath || 'file';
    }

    function boundDiffs(list) {
        var total = 0;
        var files = [];
        var hidden = 0;
        for (var i = 0; i < list.length; i++) {
            var file = list[i];
            var text = String(file.diff || '');
            var truncated = false;
            var omitted = false;
            if (total >= MAX_DIFF_TOTAL) {
                text = '';
                omitted = true;
                hidden += 1;
            } else {
                if (text.length > MAX_DIFF_FILE) {
                    text = text.slice(0, MAX_DIFF_FILE);
                    truncated = true;
                }
                if (total + text.length > MAX_DIFF_TOTAL) {
                    text = text.slice(0, MAX_DIFF_TOTAL - total);
                    truncated = true;
                }
                total += text.length;
            }
            files.push({
                oldPath: file.oldPath,
                newPath: file.newPath,
                status: file.status,
                diff: text,
                truncated: truncated,
                omitted: omitted
            });
        }
        return { files: files, hidden: hidden };
    }

    function changesHtml(snap) {
        if (!snap.diffsLoaded) return '<p class="empty">Changes could not be loaded.</p>';
        if (!snap.diffs.length) return '<p class="empty">No changes.</p>';
        var bounded = boundDiffs(snap.diffs);
        var html = '';
        if (bounded.hidden) {
            html += '<p class="empty">Patch text omitted for ' + bounded.hidden + ' file' +
                (bounded.hidden === 1 ? '' : 's') + ' after the size limit.</p>';
        }
        for (var i = 0; i < bounded.files.length; i++) {
            var file = bounded.files[i];
            html += '<section class="file"><h3><span class="file-path">' + escapeHtml(fileTitle(file)) +
                '</span> (' + escapeHtml(file.status) + ')</h3>';
            if (file.omitted) html += '<p class="empty">Diff omitted.</p>';
            else if (!file.diff) html += '<p class="empty">No text diff.</p>';
            else html += '<pre>' + escapeHtml(file.diff) + (file.truncated ? '\n… diff truncated' : '') + '</pre>';
            html += '</section>';
        }
        return html;
    }

    function cellPipe(value) {
        return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    }

    function fence(code, lang) {
        var ticks = '```';
        var body = String(code || '').replace(/\s+$/, '');
        while (body.indexOf(ticks) !== -1) ticks += '`';
        return ticks + (lang || '') + '\n' + body + '\n' + ticks;
    }

    function absolutizeMarkdown(text, origin) {
        if (!text || !origin) return String(text || '');
        return String(text).replace(/(!?\[[^\]]*\]\()(\/(?!\/)[^)\s]*)(\))/g, function (_match, open, path, close) {
            return open + origin + path + close;
        });
    }

    function mdSection(title, body, emptyText) {
        return '## ' + title + '\n\n' + (body || emptyText);
    }

    function renderMarkdown(snap) {
        var origin = originOf(snap);
        var heading = (snap.reference ? snap.reference + ' ' : '') + String(snap.title || '').replace(/\r?\n/g, ' ');
        var lines = ['# ' + (heading || 'Merge request'), ''];
        if (snap.url) {
            lines.push(snap.url);
            lines.push('');
        }
        var rows = filledRows(snap);
        if (rows.length) {
            lines.push('| Field | Value |');
            lines.push('| --- | --- |');
            for (var i = 0; i < rows.length; i++) {
                lines.push('| ' + rows[i][0] + ' | ' + cellPipe(rows[i][1]) + ' |');
            }
            lines.push('');
        }
        var description = absolutizeMarkdown(snap.description, origin).trim();
        lines.push(mdSection('Description', description, '_No description._'));
        lines.push('');
        lines.push(mdSection('Notes', notesMarkdown(snap, origin), notesEmpty(snap)));
        lines.push('');
        lines.push(mdSection('Commits', commitsMarkdown(snap), commitsEmpty(snap)));
        lines.push('');
        lines.push(mdSection('Changes', changesMarkdown(snap), changesEmpty(snap)));
        lines.push('');
        lines.push('Saved ' + formatWhen(snap.fetchedAt));
        lines.push('');
        return lines.join('\n');
    }

    function notesEmpty(snap) {
        return snap.notesLoaded ? '_No notes._' : '_Notes could not be loaded._';
    }

    function commitsEmpty(snap) {
        return snap.commitsLoaded ? '_No commits._' : '_Commits could not be loaded._';
    }

    function changesEmpty(snap) {
        return snap.diffsLoaded ? '_No changes._' : '_Changes could not be loaded._';
    }

    function notesMarkdown(snap, origin) {
        if (!snap.notesLoaded || !snap.notes.length) return '';
        var blocks = [];
        for (var i = 0; i < snap.notes.length; i++) {
            var note = snap.notes[i];
            var title = (note.author || 'Unknown') + ' — ' + formatWhen(note.created);
            var where = noteLocation(note);
            if (where) title += ' — `' + where.replace(/`/g, '\\`') + '`';
            var resolved = resolvedLabel(note);
            if (resolved) title += ' — ' + resolved;
            if (note.system) title += ' — activity';
            var body = absolutizeMarkdown(note.body, origin).trim() || '_No note body._';
            blocks.push('### ' + title + '\n\n' + body);
        }
        return blocks.join('\n\n');
    }

    function commitsMarkdown(snap) {
        if (!snap.commitsLoaded || !snap.commits.length) return '';
        var lines = [];
        for (var i = 0; i < snap.commits.length; i++) {
            var commit = snap.commits[i];
            var line = '- `' + (commit.shortId || '').replace(/`/g, '') + '` ' + String(commit.title || '').replace(/\r?\n/g, ' ');
            var bits = [];
            if (commit.author) bits.push(commit.author);
            var when = formatWhen(commit.created);
            if (when) bits.push(when);
            if (bits.length) line += ' (' + bits.join(', ') + ')';
            lines.push(line);
        }
        return lines.join('\n');
    }

    function changesMarkdown(snap) {
        if (!snap.diffsLoaded || !snap.diffs.length) return '';
        var bounded = boundDiffs(snap.diffs);
        var blocks = [];
        if (bounded.hidden) {
            blocks.push('_Patch text omitted for ' + bounded.hidden + ' file' +
                (bounded.hidden === 1 ? '' : 's') + ' after the size limit._');
        }
        for (var i = 0; i < bounded.files.length; i++) {
            var file = bounded.files[i];
            var block = '### ' + fileTitle(file) + ' (' + file.status + ')';
            if (file.omitted) block += '\n\n_Diff omitted._';
            else if (!file.diff) block += '\n\n_No text diff._';
            else block += '\n\n' + fence(file.diff + (file.truncated ? '\n… diff truncated' : ''), 'diff');
            blocks.push(block);
        }
        return blocks.join('\n\n');
    }

    function downloadText(text, filename, mime, kind) {
        return new Promise(function (resolve, reject) {
            var folder = downloadDir(kind);
            var savedAs = folder + '/' + filename;
            var blob = new Blob([text], { type: mime });
            var blobUrl = URL.createObjectURL(blob);
            function cleanup() {
                setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 10000);
            }
            function plainDownload() {
                var a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                cleanup();
                console.log('[GIT-MR] plain download triggered:', filename);
            }
            if (typeof GM_download === 'function' && text.length < 1500000) {
                console.log('[GIT-MR] using GM_download:', savedAs);
                GM_download({
                    url: 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text),
                    name: savedAs,
                    saveAs: false,
                    onload: function () {
                        console.log('[GIT-MR] GM_download finished', savedAs);
                        cleanup();
                        resolve();
                    },
                    onerror: function (err) {
                        console.log('[GIT-MR] GM_download failed, falling back', err);
                        try {
                            plainDownload();
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    }
                });
            } else {
                console.log('[GIT-MR] using plain download for', savedAs);
                try {
                    plainDownload();
                    resolve();
                } catch (e) {
                    reject(e);
                }
            }
        });
    }

    function styleButton(btn) {
        btn.style.background = '#fff';
        btn.style.color = '#030303';
        btn.style.border = 'none';
        btn.style.borderRadius = '18px';
        btn.style.padding = '8px 18px';
        btn.style.fontSize = '14px';
        btn.style.fontWeight = '500';
        btn.style.fontFamily = 'ui-sans-serif, system-ui, sans-serif';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.25)';
    }

    function barButtons() {
        var bar = document.getElementById(BAR_ID);
        if (!bar) return [];
        return bar.querySelectorAll('button');
    }

    function setBusy(busy) {
        var buttons = barButtons();
        for (var i = 0; i < buttons.length; i++) buttons[i].disabled = busy;
    }

    function flash(btn, text, title) {
        var original = btn.getAttribute('data-label') || btn.textContent;
        btn.textContent = text;
        btn.title = title || '';
        setBusy(true);
        setTimeout(function () {
            btn.textContent = original;
            btn.title = '';
            setBusy(false);
        }, 1500);
    }

    function onDownload(kind, btn) {
        var mr = mrFromUrl(location.href);
        if (!mr || btn.disabled) return;
        setBusy(true);
        btn.textContent = 'saving…';
        console.log('[GIT-MR] download clicked', kind, mr.projectPath + '!' + mr.iid);
        fetchSnapshot(mr, kind === 'html').then(function (snap) {
            var markdown = kind === 'md';
            var body = markdown ? renderMarkdown(snap) : renderHtml(snap);
            var filename = downloadBaseName(snap) + (markdown ? '.md' : '.html');
            var mime = markdown ? 'text/markdown' : 'text/html';
            return downloadText(body, filename, mime, kind).then(function () {
                console.log('[GIT-MR] saved', downloadDir(kind) + '/' + filename);
                flash(btn, 'saved');
            });
        }).catch(function (err) {
            var reason = messageFor(err);
            console.log('[GIT-MR] download FAILED:', reason, err);
            flash(btn, 'failed', reason);
        });
    }

    function makeButton(label, kind) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.setAttribute('data-label', label);
        styleButton(btn);
        btn.addEventListener('click', function () { onDownload(kind, btn); });
        return btn;
    }

    function ensureBar() {
        var mr = mrFromUrl(location.href);
        var bar = document.getElementById(BAR_ID);
        if (!mr) {
            if (bar) bar.remove();
            return;
        }
        if (!document.body) return;
        var key = mr.projectPath + '!' + mr.iid;
        if (bar) {
            bar.setAttribute('data-mr', key);
            return;
        }
        bar = document.createElement('div');
        bar.id = BAR_ID;
        bar.setAttribute('data-mr', key);
        bar.style.position = 'fixed';
        bar.style.right = '16px';
        bar.style.bottom = '16px';
        bar.style.zIndex = '99999';
        bar.style.display = 'flex';
        bar.style.gap = '8px';
        bar.appendChild(makeButton('Download HTML', 'html'));
        bar.appendChild(makeButton('Download Markdown', 'md'));
        document.body.appendChild(bar);
        console.log('[GIT-MR] button inserted for', key);
    }

    function maybeStart() {
        if (typeof document === 'undefined' || !document.documentElement || typeof location === 'undefined') return;
        var href = location.href;
        var onMr = /\/merge_requests\/\d+/.test(href);
        if (!orgConfigured()) {
            if (onMr) console.log('[GIT-MR] edit git_ui_url_organization (host only) before this page can match');
            return;
        }
        if (!startsWithOrg(href, git_ui_url_organization)) {
            if (onMr) console.log('[GIT-MR] page does not start with https://' + normalizeOrg(git_ui_url_organization));
            return;
        }
        console.log('[GIT-MR] script started (v1.0.0) on', href);
        setInterval(ensureBar, 1000);
        if (document.body) ensureBar();
        else document.addEventListener('DOMContentLoaded', ensureBar);
    }

    if (typeof document !== 'undefined') maybeStart();

    if (typeof document === 'undefined' && typeof module !== 'undefined' && module && module.exports) {
        module.exports = {
            normalizeOrg: normalizeOrg,
            startsWithOrg: startsWithOrg,
            mrFromUrl: mrFromUrl,
            toSnapshot: toSnapshot,
            sanitizeHtml: sanitizeHtml,
            renderHtml: renderHtml,
            renderMarkdown: renderMarkdown,
            messageFor: messageFor,
            downloadBaseName: downloadBaseName,
            downloadDir: downloadDir,
            absolutizeMarkdown: absolutizeMarkdown,
            headerValue: headerValue,
            boundDiffs: boundDiffs
        };
    }
})();
