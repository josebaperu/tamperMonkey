// ==UserScript==
// @name         Jira Download Issue
// @namespace    local.jira-download-issue
// @version      1.5.2
// @description  Download the open Jira Cloud issue as HTML or Markdown
// @match        https://*.atlassian.net/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      *.atlassian.net
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // Self-hosted Jira needs a second @match and @connect for that host.
    // API v2 renderedFields covers more description nodes than v3 (plain tables included).

    var BAR_ID = 'tm-jira-download-bar';
    var KEY_RE = /^[A-Za-z][A-Za-z0-9_]+-\d+$/;
    var PATH_RE = /\/(?:browse|issues)\/([A-Za-z][A-Za-z0-9_]+-\d+)/;
    var FIELDS = [
        'summary', 'description', 'comment', 'status', 'issuetype', 'priority',
        'assignee', 'reporter', 'created', 'updated', 'resolution', 'labels',
        'components', 'fixVersions', 'versions', 'attachment', 'issuelinks',
        'parent', 'subtasks', 'project'
    ].join(',');

    console.log('[JIRA] script started (v1.5.2) on', typeof location !== 'undefined' ? location.href : '');
    console.log('[JIRA] GM_download:', typeof GM_download === 'function' ? 'available' : 'missing');

    function issueKeyFromUrl(href) {
        var url;
        try {
            url = new URL(href);
        } catch (e) {
            return null;
        }
        var pathMatch = url.pathname.match(PATH_RE);
        if (pathMatch && KEY_RE.test(pathMatch[1])) return pathMatch[1];
        var selected = url.searchParams.get('selectedIssue');
        if (selected) selected = selected.trim();
        if (selected && KEY_RE.test(selected)) return selected;
        return null;
    }

    function gmGet(url) {
        return new Promise(function (resolve, reject) {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('GM_xmlhttpRequest is not available'));
                return;
            }
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                timeout: 30000,
                headers: { 'Accept': 'application/json' },
                onload: function (res) {
                    var status = res && res.status;
                    if (status >= 200 && status < 300) {
                        try {
                            resolve(JSON.parse(res.responseText));
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
            });
        });
    }

    function messageFor(err) {
        var status = err && err.status;
        if (status === 401 || status === 403) return 'session could not read the issue';
        if (status === 404) return 'unknown issue key';
        if (err && err.message) return err.message;
        return 'download failed';
    }

    function personName(user) {
        if (!user) return '';
        return user.displayName || user.name || user.emailAddress || '';
    }

    function named(value) {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'object' && value.name) return String(value.name);
        return '';
    }

    function nameList(list) {
        var out = [];
        if (!Array.isArray(list)) return out;
        for (var i = 0; i < list.length; i++) {
            var name = named(list[i]);
            if (name) out.push(name);
        }
        return out;
    }

    function mapLinks(links) {
        var out = [];
        if (!Array.isArray(links)) return out;
        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            if (!link || !link.type) continue;
            if (link.outwardIssue) {
                out.push({
                    type: link.type.outward || link.type.name || 'relates to',
                    direction: 'outward',
                    key: link.outwardIssue.key || '',
                    summary: (link.outwardIssue.fields && link.outwardIssue.fields.summary) || ''
                });
            }
            if (link.inwardIssue) {
                out.push({
                    type: link.type.inward || link.type.name || 'relates to',
                    direction: 'inward',
                    key: link.inwardIssue.key || '',
                    summary: (link.inwardIssue.fields && link.inwardIssue.fields.summary) || ''
                });
            }
        }
        return out;
    }

    function mapSubtasks(list) {
        var out = [];
        if (!Array.isArray(list)) return out;
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (!item) continue;
            var fields = item.fields || {};
            out.push({
                key: item.key || '',
                summary: fields.summary || '',
                status: named(fields.status)
            });
        }
        return out;
    }

    function mapAttachments(list) {
        var out = [];
        if (!Array.isArray(list)) return out;
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (!item) continue;
            out.push({
                filename: item.filename || '',
                size: item.size || 0,
                mimeType: item.mimeType || '',
                url: item.content || ''
            });
        }
        return out;
    }

    function mapComment(comment) {
        var html = '';
        if (comment && typeof comment.renderedBody === 'string') html = comment.renderedBody;
        else if (comment && typeof comment.body === 'string') html = comment.body;
        return {
            author: personName(comment && comment.author) || 'Unknown',
            created: (comment && comment.created) || '',
            html: html
        };
    }

    function commentsFromRendered(issue) {
        var rendered = issue.renderedFields && issue.renderedFields.comment && issue.renderedFields.comment.comments;
        var raw = issue.fields && issue.fields.comment && issue.fields.comment.comments;
        var list = rendered || raw || [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var item = list[i] || {};
            var rawItem = raw && raw[i];
            var html = '';
            if (rendered && rendered[i] && typeof rendered[i].body === 'string') html = rendered[i].body;
            else if (typeof item.renderedBody === 'string') html = item.renderedBody;
            else if (typeof item.body === 'string') html = item.body;
            out.push({
                author: personName((rawItem && rawItem.author) || item.author) || 'Unknown',
                created: (rawItem && rawItem.created) || item.created || '',
                html: html
            });
        }
        return out;
    }

    function commentsHaveHtml(comments) {
        if (!comments || !comments.length) return true;
        for (var i = 0; i < comments.length; i++) {
            if (comments[i].html) return true;
        }
        return false;
    }

    function sortComments(comments) {
        comments.sort(function (a, b) {
            return String(a.created).localeCompare(String(b.created));
        });
        return comments;
    }

    function originFromSelf(selfUrl, fallback) {
        try {
            return new URL(selfUrl).origin;
        } catch (e) {
            return fallback || '';
        }
    }

    function toSnapshot(issue, comments, fallbackOrigin) {
        var fields = (issue && issue.fields) || {};
        var rendered = (issue && issue.renderedFields) || {};
        var description = '';
        if (typeof rendered.description === 'string') description = rendered.description;
        else if (typeof fields.description === 'string') description = fields.description;
        var origin = originFromSelf(issue && issue.self, fallbackOrigin);
        var key = (issue && issue.key) || '';
        var parent = null;
        if (fields.parent && fields.parent.key) {
            parent = {
                key: fields.parent.key,
                summary: (fields.parent.fields && fields.parent.fields.summary) || ''
            };
        }
        return {
            key: key,
            url: origin && key ? origin + '/browse/' + key : '',
            fetchedAt: new Date().toISOString(),
            summary: fields.summary || '',
            project: fields.project ? (fields.project.name || fields.project.key || '') : '',
            issueType: named(fields.issuetype),
            status: named(fields.status),
            priority: named(fields.priority),
            resolution: named(fields.resolution),
            assignee: personName(fields.assignee),
            reporter: personName(fields.reporter),
            created: fields.created || '',
            updated: fields.updated || '',
            labels: Array.isArray(fields.labels) ? fields.labels.slice() : [],
            components: nameList(fields.components),
            fixVersions: nameList(fields.fixVersions),
            affectsVersions: nameList(fields.versions),
            descriptionHtml: description,
            comments: sortComments(comments || []),
            links: mapLinks(fields.issuelinks),
            attachments: mapAttachments(fields.attachment),
            parent: parent,
            subtasks: mapSubtasks(fields.subtasks)
        };
    }

    function fetchAllComments(origin, key) {
        var all = [];
        function page(startAt, guard) {
            var url = origin + '/rest/api/2/issue/' + encodeURIComponent(key) +
                '/comment?expand=renderedBody&maxResults=100&startAt=' + startAt;
            return gmGet(url).then(function (data) {
                var batch = (data && data.comments) || [];
                for (var i = 0; i < batch.length; i++) all.push(mapComment(batch[i]));
                var total = data && typeof data.total === 'number' ? data.total : all.length;
                var next = startAt + batch.length;
                if (!batch.length || next >= total || guard > 50) return all;
                return page(next, guard + 1);
            });
        }
        return page(0, 0);
    }

    function fetchSnapshot(key) {
        var origin = location.origin;
        var issueUrl = origin + '/rest/api/2/issue/' + encodeURIComponent(key) +
            '?expand=renderedFields,names&fields=' + FIELDS;
        return gmGet(issueUrl).then(function (issue) {
            return fetchAllComments(origin, key).then(function (comments) {
                if (!commentsHaveHtml(comments)) comments = commentsFromRendered(issue);
                return toSnapshot(issue, comments, origin);
            }).catch(function (err) {
                console.log('[JIRA] comment paging failed, using issue payload', err);
                return toSnapshot(issue, commentsFromRendered(issue), origin);
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

    function sanitizeHtml(html) {
        if (!html) return '';
        var doc = new DOMParser().parseFromString(String(html), 'text/html');
        stripDangerous(doc);
        stripAttrs(doc.body);
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

    // PROJECT-NUMBER_YYYYMMDD_HHMM from the issue's updated time, in local time.
    function downloadBaseName(snap) {
        var key = String((snap && snap.key) || '');
        var match = key.match(/^([A-Za-z][A-Za-z0-9_]+)-(\d+)$/);
        var prefix = match ? match[1] + '-' + match[2] : (key || 'issue');
        var date = parseWhen(snap && snap.updated) || parseWhen(snap && snap.fetchedAt) || new Date();
        return prefix + '_' + fileStamp(date);
    }

    function formatSize(bytes) {
        var n = Number(bytes) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function joinList(list) {
        if (!list || !list.length) return '';
        return list.join(', ');
    }

    function metaRows(snap) {
        var parent = '';
        if (snap.parent && snap.parent.key) {
            parent = snap.parent.key + (snap.parent.summary ? ' ' + snap.parent.summary : '');
        }
        return [
            ['Project', snap.project],
            ['Type', snap.issueType],
            ['Status', snap.status],
            ['Priority', snap.priority],
            ['Resolution', snap.resolution],
            ['Assignee', snap.assignee],
            ['Reporter', snap.reporter],
            ['Created', formatWhen(snap.created)],
            ['Updated', formatWhen(snap.updated)],
            ['Labels', joinList(snap.labels)],
            ['Components', joinList(snap.components)],
            ['Fix versions', joinList(snap.fixVersions)],
            ['Affects versions', joinList(snap.affectsVersions)],
            ['Parent', parent]
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

    var CSS = [
        'body { margin: 0; background: #fafaf7; color: #1c1c1c; font: 16px/1.5 Georgia, "Iowan Old Style", Palatino, serif; }',
        'main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }',
        '.key, .meta, dl, .source, footer { font-family: ui-sans-serif, system-ui, sans-serif; }',
        '.key { margin: 0; letter-spacing: .04em; color: #5c5c5c; font-size: 13px; }',
        'h1 { font-size: 1.75rem; line-height: 1.25; margin: 4px 0 8px; }',
        'h2 { font-size: 1.2rem; margin: 28px 0 8px; }',
        '.source, footer { font-size: 13px; color: #5c5c5c; }',
        'dl { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; font-size: 14px; margin: 16px 0; }',
        'dt { color: #5c5c5c; }',
        'dd { margin: 0; }',
        'table { border-collapse: collapse; width: 100%; margin: 12px 0; }',
        'th, td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; text-align: left; }',
        'th { background: #f0f0ea; }',
        'pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }',
        'pre { background: #f0f0ea; padding: 12px; overflow: auto; }',
        'blockquote { border-left: 3px solid #ccc; margin: 12px 0; padding-left: 12px; color: #333; }',
        'img { max-width: 100%; height: auto; }',
        '.comment { border-top: 1px solid #e4e4dc; padding: 12px 0; }',
        '.meta { font-size: 13px; color: #5c5c5c; margin: 0 0 8px; }',
        '.empty { color: #777; font-style: italic; }',
        'a { color: #0b57d0; }',
        'ul, ol { padding-left: 1.4em; }'
    ].join('\n');

    function renderHtml(snap) {
        var rows = filledRows(snap);
        var meta = '';
        if (rows.length) {
            meta = '<dl>';
            for (var i = 0; i < rows.length; i++) {
                meta += '<dt>' + escapeHtml(rows[i][0]) + '</dt><dd>' + escapeHtml(rows[i][1]) + '</dd>';
            }
            meta += '</dl>';
        }
        var description = sanitizeHtml(snap.descriptionHtml);
        if (!description || !description.trim()) description = '<p class="empty">No description.</p>';

        var comments = '';
        if (!snap.comments.length) {
            comments = '<p class="empty">No comments.</p>';
        } else {
            for (var c = 0; c < snap.comments.length; c++) {
                var comment = snap.comments[c];
                var body = sanitizeHtml(comment.html);
                if (!body || !body.trim()) body = '<p class="empty">No comment body.</p>';
                comments += '<article class="comment"><p class="meta">' + escapeHtml(comment.author || 'Unknown') +
                    ' — ' + escapeHtml(formatWhen(comment.created)) + '</p>' + body + '</article>';
            }
        }

        return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
            '<title>' + escapeHtml(snap.key + ' ' + snap.summary) + '</title>\n<style>\n' + CSS + '\n</style>\n</head>\n<body>\n<main>\n' +
            '<p class="key">' + escapeHtml(snap.key) + '</p>\n' +
            '<h1>' + escapeHtml(snap.summary || snap.key) + '</h1>\n' +
            (snap.url ? '<p class="source"><a href="' + escapeHtml(snap.url) + '">' + escapeHtml(snap.url) + '</a></p>\n' : '') +
            meta +
            '<h2>Description</h2>\n<div class="description">' + description + '</div>\n' +
            '<h2>Comments</h2>\n' + comments + '\n' +
            '<h2>Links</h2>\n' + linkListHtml(snap) + '\n' +
            '<h2>Subtasks</h2>\n' + subtaskListHtml(snap) + '\n' +
            '<h2>Attachments</h2>\n' + attachmentListHtml(snap) + '\n' +
            '<footer>Saved ' + escapeHtml(formatWhen(snap.fetchedAt)) + '</footer>\n' +
            '</main>\n</body>\n</html>\n';
    }

    function browseUrl(snap, key) {
        if (!key) return '';
        try {
            return new URL('/browse/' + key, snap.url || 'https://example.atlassian.net').href;
        } catch (e) {
            return '';
        }
    }

    function linkListHtml(snap) {
        if (!snap.links.length) return '<p class="empty">No links.</p>';
        var html = '<ul>';
        for (var i = 0; i < snap.links.length; i++) {
            var link = snap.links[i];
            var href = browseUrl(snap, link.key);
            var keyHtml = href ? '<a href="' + escapeHtml(href) + '">' + escapeHtml(link.key) + '</a>' : escapeHtml(link.key);
            html += '<li>' + escapeHtml(link.type) + ' ' + keyHtml +
                (link.summary ? ' ' + escapeHtml(link.summary) : '') + '</li>';
        }
        return html + '</ul>';
    }

    function subtaskListHtml(snap) {
        if (!snap.subtasks.length) return '<p class="empty">No subtasks.</p>';
        var html = '<ul>';
        for (var i = 0; i < snap.subtasks.length; i++) {
            var item = snap.subtasks[i];
            var href = browseUrl(snap, item.key);
            var keyHtml = href ? '<a href="' + escapeHtml(href) + '">' + escapeHtml(item.key) + '</a>' : escapeHtml(item.key);
            html += '<li>' + keyHtml + (item.summary ? ' ' + escapeHtml(item.summary) : '') +
                (item.status ? ' (' + escapeHtml(item.status) + ')' : '') + '</li>';
        }
        return html + '</ul>';
    }

    function attachmentListHtml(snap) {
        if (!snap.attachments.length) return '<p class="empty">No attachments.</p>';
        var html = '<ul>';
        for (var i = 0; i < snap.attachments.length; i++) {
            var item = snap.attachments[i];
            var label = escapeHtml(item.filename || 'attachment') + ' (' + escapeHtml(formatSize(item.size)) + ')';
            if (item.url && !unsafeUrl(item.url)) {
                html += '<li><a href="' + escapeHtml(item.url) + '">' + label + '</a></li>';
            } else {
                html += '<li>' + label + '</li>';
            }
        }
        return html + '</ul>';
    }

    function mdText(value) {
        return String(value == null ? '' : value).replace(/[\\*`\[\]]/g, '\\$&');
    }

    function mdDest(url) {
        var text = String(url || '');
        if (!text || unsafeUrl(text)) return '';
        if (/[\s)]/.test(text)) return '<' + text.replace(/>/g, '%3E') + '>';
        return text;
    }

    function cellPipe(value) {
        return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    }

    function normalizeInline(value) {
        return String(value || '')
            .replace(/[ \t]*\n[ \t]*/g, '\n')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/^\s+|\s+$/g, '')
            .replace(/\n/g, '  \n');
    }

    function isBlockTag(tag) {
        return tag === 'p' || tag === 'div' || tag === 'ul' || tag === 'ol' || tag === 'pre' ||
            tag === 'blockquote' || tag === 'table' || tag === 'hr' || tag === 'h1' || tag === 'h2' ||
            tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6' || tag === 'section' || tag === 'article';
    }

    function hasBlockChild(el) {
        var children = el.children || [];
        for (var i = 0; i < children.length; i++) {
            if (isBlockTag(children[i].tagName.toLowerCase())) return true;
        }
        return false;
    }

    function inlineNode(node) {
        if (!node) return '';
        if (node.nodeType === 3) return mdText(node.textContent);
        if (node.nodeType !== 1) return '';
        var tag = node.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed') return '';
        if (tag === 'br') return '\n';
        if (tag === 'img') return imageMd(node);
        if (tag === 'a') return linkMd(node);
        if (tag === 'strong' || tag === 'b') return wrapMd('**', node);
        if (tag === 'em' || tag === 'i') return wrapMd('*', node);
        if (tag === 'code') return '`' + String(node.textContent || '').replace(/`/g, '\\`') + '`';
        if (isBlockTag(tag)) return inlineChildren(node);
        return inlineChildren(node);
    }

    function inlineChildren(el) {
        var out = '';
        var nodes = el.childNodes || [];
        for (var i = 0; i < nodes.length; i++) out += inlineNode(nodes[i]);
        return out;
    }

    function wrapMd(mark, el) {
        var inner = normalizeInline(inlineChildren(el));
        if (!inner) return '';
        return mark + inner + mark;
    }

    function linkMd(el) {
        var href = mdDest(el.getAttribute('href'));
        var text = normalizeInline(inlineChildren(el)) || href;
        if (!href) return text;
        return '[' + text + '](' + href + ')';
    }

    function imageMd(el) {
        var src = mdDest(el.getAttribute('src'));
        if (!src) return '';
        var alt = mdText(el.getAttribute('alt') || '');
        return '![' + alt + '](' + src + ')';
    }

    function trimBlock(value) {
        return String(value || '').replace(/^\n+|\n+$/g, '');
    }

    function fence(code) {
        var ticks = '```';
        var body = String(code || '').replace(/\s+$/, '');
        while (body.indexOf(ticks) !== -1) ticks += '`';
        return ticks + '\n' + body + '\n' + ticks;
    }

    function renderList(el, ordered) {
        var lines = [];
        var n = 1;
        var children = el.children || [];
        for (var i = 0; i < children.length; i++) {
            if (children[i].tagName.toLowerCase() !== 'li') continue;
            var marker = ordered ? (n + '. ') : '- ';
            n += 1;
            var body = trimBlock(renderLi(children[i]));
            var parts = body.split('\n');
            var pad = new Array(marker.length + 1).join(' ');
            for (var p = 1; p < parts.length; p++) {
                if (parts[p]) parts[p] = pad + parts[p];
            }
            lines.push(marker + parts.join('\n'));
        }
        return lines.join('\n');
    }

    function renderLi(li) {
        var parts = [];
        var inlineBuf = '';
        function flush() {
            var text = normalizeInline(inlineBuf);
            if (text) parts.push(text);
            inlineBuf = '';
        }
        var nodes = li.childNodes || [];
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node.nodeType === 3) {
                inlineBuf += node.textContent;
                continue;
            }
            if (node.nodeType !== 1) continue;
            var tag = node.tagName.toLowerCase();
            if (isBlockTag(tag)) {
                flush();
                parts.push(trimBlock(renderBlock(node)));
            } else {
                inlineBuf += inlineNode(node);
            }
        }
        flush();
        return parts.join('\n\n');
    }

    function renderTable(table) {
        var rows = table.rows || [];
        if (!rows.length) return '';
        var matrix = [];
        var width = 0;
        for (var i = 0; i < rows.length; i++) {
            var cells = rows[i].cells || [];
            var line = [];
            for (var c = 0; c < cells.length; c++) {
                line.push(cellPipe(normalizeInline(inlineChildren(cells[c]))));
            }
            if (line.length > width) width = line.length;
            matrix.push(line);
        }
        if (!width) return '';
        function pad(line) {
            var copy = line.slice();
            while (copy.length < width) copy.push('');
            return '| ' + copy.join(' | ') + ' |';
        }
        var sep = [];
        for (var s = 0; s < width; s++) sep.push('---');
        var out = [pad(matrix[0]), '| ' + sep.join(' | ') + ' |'];
        for (var r = 1; r < matrix.length; r++) out.push(pad(matrix[r]));
        return out.join('\n');
    }

    function renderBlock(el) {
        var tag = el.tagName.toLowerCase();
        if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
            var level = Number(tag.charAt(1));
            return new Array(level + 1).join('#') + ' ' + normalizeInline(inlineChildren(el));
        }
        if (tag === 'pre') return fence(el.textContent || '');
        if (tag === 'blockquote') {
            var inner = trimBlock(renderChildren(el));
            if (!inner) return '';
            return '> ' + inner.replace(/\n/g, '\n> ');
        }
        if (tag === 'ul') return renderList(el, false);
        if (tag === 'ol') return renderList(el, true);
        if (tag === 'table') return renderTable(el);
        if (tag === 'hr') return '---';
        if ((tag === 'div' || tag === 'section' || tag === 'article') && hasBlockChild(el)) return trimBlock(renderChildren(el));
        return normalizeInline(inlineChildren(el));
    }

    function renderChildren(el) {
        var blocks = [];
        var inlineBuf = '';
        function flush() {
            var text = normalizeInline(inlineBuf);
            if (text) blocks.push(text);
            inlineBuf = '';
        }
        var nodes = el.childNodes || [];
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node.nodeType === 3) {
                inlineBuf += node.textContent;
                continue;
            }
            if (node.nodeType !== 1) continue;
            var tag = node.tagName.toLowerCase();
            if (tag === 'br') {
                inlineBuf += '\n';
                continue;
            }
            if (isBlockTag(tag)) {
                flush();
                var block = trimBlock(renderBlock(node));
                if (block) blocks.push(block);
            } else {
                inlineBuf += inlineNode(node);
            }
        }
        flush();
        return blocks.join('\n\n');
    }

    function htmlToMarkdown(html) {
        var clean = sanitizeHtml(html);
        if (!clean || !clean.trim()) return '';
        var doc = new DOMParser().parseFromString(clean, 'text/html');
        stripDangerous(doc);
        return renderChildren(doc.body).replace(/\n{3,}/g, '\n\n').trim();
    }

    function mdSection(title, body, emptyText) {
        return '## ' + title + '\n\n' + (body || emptyText);
    }

    function renderMarkdown(snap) {
        var lines = ['# ' + snap.key + ' ' + String(snap.summary || '').replace(/\r?\n/g, ' '), ''];
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
        lines.push(mdSection('Description', htmlToMarkdown(snap.descriptionHtml), '_No description._'));
        lines.push('');
        lines.push(mdSection('Comments', commentsMarkdown(snap), '_No comments._'));
        lines.push('');
        lines.push(mdSection('Links', linksMarkdown(snap), '_No links._'));
        lines.push('');
        lines.push(mdSection('Subtasks', subtasksMarkdown(snap), '_No subtasks._'));
        lines.push('');
        lines.push(mdSection('Attachments', attachmentsMarkdown(snap), '_No attachments._'));
        lines.push('');
        lines.push('Saved ' + formatWhen(snap.fetchedAt));
        lines.push('');
        return lines.join('\n');
    }

    function commentsMarkdown(snap) {
        if (!snap.comments.length) return '';
        var blocks = [];
        for (var i = 0; i < snap.comments.length; i++) {
            var comment = snap.comments[i];
            var body = htmlToMarkdown(comment.html) || '_No comment body._';
            blocks.push('### ' + (comment.author || 'Unknown') + ' — ' + formatWhen(comment.created) + '\n\n' + body);
        }
        return blocks.join('\n\n');
    }

    function linksMarkdown(snap) {
        if (!snap.links.length) return '';
        var lines = [];
        for (var i = 0; i < snap.links.length; i++) {
            var link = snap.links[i];
            lines.push('- ' + link.type + ' ' + link.key + (link.summary ? ' ' + link.summary : ''));
        }
        return lines.join('\n');
    }

    function subtasksMarkdown(snap) {
        if (!snap.subtasks.length) return '';
        var lines = [];
        for (var i = 0; i < snap.subtasks.length; i++) {
            var item = snap.subtasks[i];
            lines.push('- ' + item.key + (item.summary ? ' ' + item.summary : '') + (item.status ? ' (' + item.status + ')' : ''));
        }
        return lines.join('\n');
    }

    function attachmentsMarkdown(snap) {
        if (!snap.attachments.length) return '';
        var lines = [];
        for (var i = 0; i < snap.attachments.length; i++) {
            var item = snap.attachments[i];
            var line = '- ' + (item.filename || 'attachment') + ' (' + formatSize(item.size) + ')';
            if (item.url) line += ' ' + item.url;
            lines.push(line);
        }
        return lines.join('\n');
    }

    function downloadFolder(kind) {
        return kind === 'md' ? 'jiraMD' : 'jiraHtml';
    }

    // text/plain makes the browser replace .html and .md with .txt.
    function downloadMime(filename) {
        var name = String(filename || '').toLowerCase();
        if (name.slice(-5) === '.html' || name.slice(-4) === '.htm') return 'text/html';
        if (name.slice(-3) === '.md') return 'text/markdown';
        return 'text/plain';
    }

    function downloadText(text, filename, folder) {
        var mime = downloadMime(filename);
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
            console.log('[JIRA] plain download cannot choose a folder');
            console.log('[JIRA] plain download file name:', filename);
        }

        return new Promise(function (resolve, reject) {
            if (typeof GM_download !== 'function') {
                console.log('[JIRA] GM_download not available, using plain download');
                try {
                    plainDownload();
                    resolve();
                } catch (e) {
                    reject(e);
                }
                return;
            }

            var name = folder + '/' + filename;
            var dot = filename.lastIndexOf('.');
            var extension = dot === -1 ? '' : filename.slice(dot);
            console.log('[JIRA] GM_download path:', 'Downloads/' + name);
            console.log('[JIRA] GM_download type:', mime, 'extension:', extension || '(none)', 'chars:', text.length);
            GM_download({
                url: 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text),
                name: name,
                saveAs: false,
                onload: function () {
                    console.log('[JIRA] GM_download finished:', 'Downloads/' + name);
                    cleanup();
                    resolve();
                },
                onerror: function (err) {
                    var code = err && err.error ? err.error : '';
                    var details = err && err.details ? err.details : '';
                    console.log('[JIRA] GM_download failed');
                    console.log('[JIRA] GM_download error code:', code || '(none)');
                    console.log('[JIRA] GM_download error details:', details || err);
                    if (code === 'not_whitelisted') {
                        console.log('[JIRA] add', extension || 'this extension', 'to Tampermonkey Whitelisted File Extensions');
                        cleanup();
                        reject(new Error('add html and md to Tampermonkey Whitelisted File Extensions'));
                        return;
                    }
                    try {
                        plainDownload();
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }
            });
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
        var key = issueKeyFromUrl(location.href);
        if (!key || btn.disabled) return;
        var folder = downloadFolder(kind);
        setBusy(true);
        btn.textContent = 'saving…';
        console.log('[JIRA] download clicked', kind, key, 'folder:', folder);
        fetchSnapshot(key).then(function (snap) {
            var markdown = kind === 'md';
            var body = markdown ? renderMarkdown(snap) : renderHtml(snap);
            var filename = downloadBaseName(snap) + (markdown ? '.md' : '.html');
            console.log('[JIRA] issue loaded', snap.key, 'file:', filename, 'chars:', body.length);
            return downloadText(body, filename, folder).then(function () {
                console.log('[JIRA] saved', folder + '/' + filename);
                flash(btn, 'saved');
            });
        }).catch(function (err) {
            var reason = messageFor(err);
            console.log('[JIRA] download FAILED:', reason, err);
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
        var key = issueKeyFromUrl(location.href);
        var bar = document.getElementById(BAR_ID);
        if (!key) {
            if (bar) bar.remove();
            return;
        }
        if (!document.body) return;
        if (bar) {
            bar.setAttribute('data-key', key);
            return;
        }
        bar = document.createElement('div');
        bar.id = BAR_ID;
        bar.setAttribute('data-key', key);
        bar.style.position = 'fixed';
        bar.style.right = '16px';
        bar.style.bottom = '16px';
        bar.style.zIndex = '99999';
        bar.style.display = 'flex';
        bar.style.gap = '8px';
        bar.appendChild(makeButton('Download HTML', 'html'));
        bar.appendChild(makeButton('Download Markdown', 'md'));
        document.body.appendChild(bar);
        console.log('[JIRA] button inserted for', key);
    }

    if (typeof document !== 'undefined' && document.documentElement) {
        setInterval(ensureBar, 1000);
        if (document.body) ensureBar();
        else document.addEventListener('DOMContentLoaded', ensureBar);
    }

    if (typeof document === 'undefined' && typeof module !== 'undefined' && module && module.exports) {
        module.exports = {
            issueKeyFromUrl: issueKeyFromUrl,
            toSnapshot: toSnapshot,
            commentsFromRendered: commentsFromRendered,
            sanitizeHtml: sanitizeHtml,
            htmlToMarkdown: htmlToMarkdown,
            renderHtml: renderHtml,
            renderMarkdown: renderMarkdown,
            messageFor: messageFor,
            downloadBaseName: downloadBaseName
        };
    }
})();
