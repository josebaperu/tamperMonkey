// ==UserScript==
// @name         GitHub Download Pull Request
// @namespace    local.git-downloader-pr
// @version      1.0.0
// @description  Download the open GitHub pull request as HTML or Markdown
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
//
// git-downloader-mr.user.js is the GitLab merge request script. It does not
// match GitHub pull request URLs or the GitHub API.

(function () {
    'use strict';

    // Edit this before use. Host, or host plus a path. Scheme and trailing slash are optional.
    // The page URL must start with https:// plus this value.
    // Example: github.com
    // Example limited to one organization: github.com/my-org
    // Example GitHub Enterprise: github.example.com
    var git_ui_url_organization = 'YOUR_GITHUB_HOST';

    var BAR_ID = 'tm-git-pr-download-bar';
    var PLACEHOLDER_ORG = 'YOUR_GITHUB_HOST';
    var ACTOR_FIELDS = 'login ... on User { name } ... on Organization { name }';
    var ASSIGNEE_FIELDS = '... on User { login name } ... on Bot { login } ... on Mannequin { login } ... on Organization { login name }';
    var REVIEWER_FIELDS = '... on User { login name } ... on Bot { login } ... on Mannequin { login } ... on Team { teamName: name }';
    var COMMENT_NODE = 'author { ' + ACTOR_FIELDS + ' } createdAt body bodyHTML';

    var CORE_QUERY = [
        'query($owner:String!,$name:String!,$number:Int!){',
        'repository(owner:$owner,name:$name){',
        'pullRequest(number:$number){',
        'number title body bodyHTML url state isDraft checksUrl',
        'author { ' + ACTOR_FIELDS + ' }',
        'milestone { title }',
        'headRefName baseRefName',
        'createdAt updatedAt mergedAt closedAt',
        'mergeStateStatus reviewDecision headRefOid',
        'reactionGroups { content reactors { totalCount } }',
        'statusCheckRollup { state }',
        '}}}',
    ].join(' ');

    var COMMENTS_FIELD = 'comments(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{' + COMMENT_NODE + '}}';
    var REVIEWS_FIELD = 'reviews(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{state createdAt body bodyHTML author{' + ACTOR_FIELDS + '}}}';
    var THREADS_FIELD = 'reviewThreads(first:50,after:$cursor){pageInfo{hasNextPage endCursor}nodes{id isResolved isOutdated path line originalLine comments(first:100){pageInfo{hasNextPage endCursor}nodes{' + COMMENT_NODE + '}}}}';
    var COMMITS_FIELD = 'commits(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{commit{oid messageHeadline authoredDate author{name email user{login}}}}}';
    var ASSIGNEES_FIELD = 'assignees(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{login name}}';
    var LABELS_FIELD = 'labels(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{name}}';
    var REVIEW_REQUESTS_FIELD = 'reviewRequests(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{requestedReviewer{' + REVIEWER_FIELDS + '}}}';
    var ACTIVITY_TYPES = [
        'ADDED_TO_MERGE_QUEUE_EVENT',
        'ASSIGNED_EVENT',
        'AUTO_MERGE_DISABLED_EVENT',
        'AUTO_MERGE_ENABLED_EVENT',
        'CLOSED_EVENT',
        'CONVERT_TO_DRAFT_EVENT',
        'CROSS_REFERENCED_EVENT',
        'DEMILESTONED_EVENT',
        'HEAD_REF_DELETED_EVENT',
        'HEAD_REF_FORCE_PUSHED_EVENT',
        'HEAD_REF_RESTORED_EVENT',
        'LABELED_EVENT',
        'LOCKED_EVENT',
        'MERGED_EVENT',
        'MILESTONED_EVENT',
        'READY_FOR_REVIEW_EVENT',
        'REMOVED_FROM_MERGE_QUEUE_EVENT',
        'RENAMED_TITLE_EVENT',
        'REOPENED_EVENT',
        'REVIEW_DISMISSED_EVENT',
        'REVIEW_REQUESTED_EVENT',
        'REVIEW_REQUEST_REMOVED_EVENT',
        'UNASSIGNED_EVENT',
        'UNLABELED_EVENT',
        'UNLOCKED_EVENT'
    ].join(',');
    var ACTIVITY_NODES = [
        '__typename',
        '... on AddedToMergeQueueEvent { createdAt actor { ' + ACTOR_FIELDS + ' } }',
        '... on AssignedEvent { createdAt actor { ' + ACTOR_FIELDS + ' } assignee { ' + ASSIGNEE_FIELDS + ' } }',
        '... on AutoMergeDisabledEvent { createdAt reason actor { ' + ACTOR_FIELDS + ' } }',
        '... on AutoMergeEnabledEvent { createdAt actor { ' + ACTOR_FIELDS + ' } }',
        '... on ClosedEvent { createdAt actor { ' + ACTOR_FIELDS + ' } }',
        '... on ConvertToDraftEvent { createdAt actor { ' + ACTOR_FIELDS + ' } }',
        '... on CrossReferencedEvent { createdAt actor { ' + ACTOR_FIELDS + ' } }',
        '... on DemilestonedEvent { createdAt milestoneTitle actor { ' + ACTOR_FIELDS + ' } }',
        '... on HeadRefDeletedEvent { createdAt headRefName actor { ' + ACTOR_FIELDS + ' } }',
        '... on HeadRefForcePushedEvent { createdAt actor { ' + ACTOR_FIELDS + ' } }',
        '... on HeadRefRestoredEvent { createdAt actor { ' + ACTOR_FIELDS + ' } }',
        '... on LabeledEvent { createdAt actor { ' + ACTOR_FIELDS + ' } label { name } }',
        '... on LockedEvent { createdAt actor { ' + ACTOR_FIELDS + ' } }',
        '... on MergedEvent { createdAt mergeRefName actor { ' + ACTOR_FIELDS + ' } }',
        '... on MilestonedEvent { createdAt milestoneTitle actor { ' + ACTOR_FIELDS + ' } }',
        '... on ReadyForReviewEvent { createdAt actor { ' + ACTOR_FIELDS + ' } }',
        '... on RemovedFromMergeQueueEvent { createdAt reason actor { ' + ACTOR_FIELDS + ' } }',
        '... on RenamedTitleEvent { createdAt previousTitle currentTitle actor { ' + ACTOR_FIELDS + ' } }',
        '... on ReopenedEvent { createdAt actor { ' + ACTOR_FIELDS + ' } }',
        '... on ReviewDismissedEvent { createdAt previousReviewState dismissalMessage actor { ' + ACTOR_FIELDS + ' } }',
        '... on ReviewRequestedEvent { createdAt actor { ' + ACTOR_FIELDS + ' } requestedReviewer { ' + REVIEWER_FIELDS + ' } }',
        '... on ReviewRequestRemovedEvent { createdAt actor { ' + ACTOR_FIELDS + ' } requestedReviewer { ' + REVIEWER_FIELDS + ' } }',
        '... on UnassignedEvent { createdAt actor { ' + ACTOR_FIELDS + ' } assignee { ' + ASSIGNEE_FIELDS + ' } }',
        '... on UnlabeledEvent { createdAt actor { ' + ACTOR_FIELDS + ' } label { name } }',
        '... on UnlockedEvent { createdAt actor { ' + ACTOR_FIELDS + ' } }'
    ].join(' ');
    var ACTIVITY_FIELD = 'timelineItems(first:100,after:$cursor,itemTypes:[' + ACTIVITY_TYPES + ']){pageInfo{hasNextPage endCursor}nodes{' + ACTIVITY_NODES + '}}';
    var THREAD_MORE_QUERY = 'query($id:ID!,$cursor:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{' + COMMENT_NODE + '}}}}}';

    function pageQuery(field) {
        return 'query($owner:String!,$name:String!,$number:Int!,$cursor:String){' +
            'repository(owner:$owner,name:$name){pullRequest(number:$number){' + field + '}}}';
    }

    function graphqlQueries() {
        return [
            CORE_QUERY,
            pageQuery(COMMENTS_FIELD),
            pageQuery(REVIEWS_FIELD),
            pageQuery(THREADS_FIELD),
            pageQuery(COMMITS_FIELD),
            pageQuery(ASSIGNEES_FIELD),
            pageQuery(LABELS_FIELD),
            pageQuery(REVIEW_REQUESTS_FIELD),
            pageQuery(ACTIVITY_FIELD),
            THREAD_MORE_QUERY
        ];
    }

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

    function prFromUrl(href, orgValue) {
        if (!startsWithOrg(href, orgValue)) return null;
        var url;
        try {
            url = new URL(href);
        } catch (e) {
            return null;
        }
        var match = (url.pathname || '').match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$|\.)/);
        if (!match) return null;
        var owner = safeDecode(match[1]);
        var repo = safeDecode(match[2]);
        if (!owner || !repo) return null;
        return {
            owner: owner,
            repo: repo,
            projectPath: owner + '/' + repo,
            number: match[3],
            origin: url.origin
        };
    }

    function csrfToken() {
        try {
            var meta = document.querySelector('meta[name="csrf-token"]');
            return meta ? (meta.getAttribute('content') || '') : '';
        } catch (e) {
            return '';
        }
    }

    // Same-origin /graphql uses the logged-in browser session.
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
                            var parseErr = new Error('response was not JSON');
                            parseErr.status = status;
                            reject(parseErr);
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
                headers['X-Requested-With'] = 'XMLHttpRequest';
                var token = csrfToken();
                if (token) headers['X-CSRF-Token'] = token;
                options.data = JSON.stringify(body);
            }
            GM_xmlhttpRequest(options);
        });
    }

    function gql(origin, query, variables) {
        return gmRequest('POST', origin + '/graphql', {
            query: query,
            variables: variables || {}
        }).then(function (res) {
            var json = res.json || {};
            if (json.message && json.data == null && !json.errors) {
                var err = new Error(json.message);
                err.status = /rate limit/i.test(json.message) ? 403 : 401;
                throw err;
            }
            if (!json.data && json.errors && json.errors.length) {
                var first = json.errors[0] || {};
                var err2 = new Error(first.message || 'GraphQL error');
                var msg = String(first.message || '');
                if (/not found|could not resolve/i.test(msg)) err2.status = 404;
                else if (/authenticat|forbidden|unauthorized|login|resource not accessible/i.test(msg)) err2.status = 401;
                throw err2;
            }
            if (json.errors && json.errors.length) console.log('[GIT-PR] graphql errors', json.errors);
            return json.data || {};
        });
    }

    function pullFromData(data) {
        var repo = data && data.repository;
        var pull = repo && repo.pullRequest;
        if (pull) return pull;
        var err = new Error('unknown pull request');
        err.status = 404;
        throw err;
    }

    function fetchPrPages(pr, field, readConnection) {
        var query = pageQuery(field);
        var all = [];
        function page(cursor, guard) {
            return gql(pr.origin, query, {
                owner: pr.owner,
                name: pr.repo,
                number: Number(pr.number),
                cursor: cursor
            }).then(function (data) {
                var conn = readConnection(pullFromData(data)) || {};
                var nodes = conn.nodes || [];
                for (var i = 0; i < nodes.length; i++) if (nodes[i]) all.push(nodes[i]);
                var info = conn.pageInfo || {};
                if (!info.hasNextPage || !info.endCursor || !nodes.length || guard > 50) return all;
                return page(info.endCursor, guard + 1);
            });
        }
        return page(null, 0);
    }

    function commentNodes(conn) {
        var nodes = (conn && conn.nodes) || [];
        var out = [];
        for (var i = 0; i < nodes.length; i++) if (nodes[i]) out.push(nodes[i]);
        return out;
    }

    function fetchThreadComments(pr, thread) {
        var all = commentNodes(thread && thread.comments);
        var info = (thread && thread.comments && thread.comments.pageInfo) || {};
        function more(cursor, guard) {
            if (!cursor || guard > 50) return Promise.resolve(all);
            return gql(pr.origin, THREAD_MORE_QUERY, { id: thread.id, cursor: cursor }).then(function (data) {
                var conn = data && data.node && data.node.comments;
                var batch = commentNodes(conn);
                for (var i = 0; i < batch.length; i++) all.push(batch[i]);
                var next = conn && conn.pageInfo;
                if (!next || !next.hasNextPage || !next.endCursor || !batch.length) return all;
                return more(next.endCursor, guard + 1);
            });
        }
        if (!thread || !thread.id || !info.hasNextPage || !info.endCursor) return Promise.resolve(all);
        return more(info.endCursor, 1);
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

    function fetchThreads(pr) {
        return fetchPrPages(pr, THREADS_FIELD, function (pull) { return pull.reviewThreads; }).then(function (threads) {
            return mapPool(threads, 4, function (thread) {
                return fetchThreadComments(pr, thread).then(function (comments) {
                    thread._comments = comments;
                });
            }).then(function () { return threads; });
        });
    }

    function soft(promise, label) {
        return promise.then(function (value) {
            return { ok: true, value: value };
        }).catch(function (err) {
            console.log('[GIT-PR] ' + label + ' failed', err);
            return { ok: false, value: null };
        });
    }

    function messageFor(err) {
        var status = err && err.status;
        var text = err && err.message ? String(err.message) : '';
        if (/rate limit/i.test(text)) return 'GitHub rate limit reached';
        if (status === 401 || status === 403) return 'session could not read the pull request';
        if (status === 404) return 'unknown pull request';
        if (text) return text;
        return 'download failed';
    }

    function personName(user) {
        if (!user) return '';
        var name = user.name || user.teamName || '';
        var username = user.login || user.username || '';
        if (name && username) return name + ' (@' + username + ')';
        if (username) return '@' + username;
        return name || user.email || '';
    }

    function peopleList(list) {
        var out = [];
        if (!Array.isArray(list)) return out;
        for (var i = 0; i < list.length; i++) {
            var name = personName(list[i]);
            if (name) out.push(name);
        }
        return out;
    }

    function humanToken(value) {
        return String(value || '').replace(/_/g, ' ');
    }

    function oneLine(value) {
        return String(value == null ? '' : value).replace(/\r?\n/g, ' ');
    }

    function reviewTag(state) {
        if (state === 'APPROVED') return 'approved';
        if (state === 'CHANGES_REQUESTED') return 'changes requested';
        if (state === 'DISMISSED') return 'dismissed';
        if (state === 'COMMENTED') return 'review';
        return '';
    }

    function reviewFallback(state) {
        if (state === 'APPROVED') return 'Approved this pull request.';
        if (state === 'CHANGES_REQUESTED') return 'Requested changes.';
        if (state === 'DISMISSED') return 'Dismissed a previous review.';
        return '';
    }

    function activityBody(event) {
        if (!event || !event.__typename) return '';
        var type = event.__typename;
        if (type === 'ClosedEvent') return 'closed this';
        if (type === 'ReopenedEvent') return 'reopened this';
        if (type === 'MergedEvent') return event.mergeRefName ? 'merged this into ' + event.mergeRefName : 'merged this';
        if (type === 'LabeledEvent') return 'added the label ' + ((event.label && event.label.name) || '');
        if (type === 'UnlabeledEvent') return 'removed the label ' + ((event.label && event.label.name) || '');
        if (type === 'AssignedEvent') return 'assigned ' + (personName(event.assignee) || 'someone');
        if (type === 'UnassignedEvent') return 'unassigned ' + (personName(event.assignee) || 'someone');
        if (type === 'ReviewRequestedEvent') return 'requested a review from ' + (personName(event.requestedReviewer) || 'someone');
        if (type === 'ReviewRequestRemovedEvent') return 'removed a review request from ' + (personName(event.requestedReviewer) || 'someone');
        if (type === 'ConvertToDraftEvent') return 'marked this as a draft';
        if (type === 'ReadyForReviewEvent') return 'marked this as ready for review';
        if (type === 'RenamedTitleEvent') {
            return 'renamed this from "' + oneLine(event.previousTitle) + '" to "' + oneLine(event.currentTitle) + '"';
        }
        if (type === 'HeadRefForcePushedEvent') return 'force-pushed the branch';
        if (type === 'HeadRefDeletedEvent') return event.headRefName ? 'deleted the branch ' + event.headRefName : 'deleted the branch';
        if (type === 'HeadRefRestoredEvent') return 'restored the branch';
        if (type === 'MilestonedEvent') return 'added this to milestone ' + (event.milestoneTitle || '');
        if (type === 'DemilestonedEvent') return 'removed this from milestone ' + (event.milestoneTitle || '');
        if (type === 'ReviewDismissedEvent') {
            var text = 'dismissed a review';
            if (event.previousReviewState) text += ' (' + humanToken(event.previousReviewState) + ')';
            if (event.dismissalMessage) text += ': ' + oneLine(event.dismissalMessage);
            return text;
        }
        if (type === 'LockedEvent') return 'locked this conversation';
        if (type === 'UnlockedEvent') return 'unlocked this conversation';
        if (type === 'AutoMergeEnabledEvent') return 'enabled auto-merge';
        if (type === 'AutoMergeDisabledEvent') return event.reason ? 'disabled auto-merge: ' + oneLine(event.reason) : 'disabled auto-merge';
        if (type === 'AddedToMergeQueueEvent') return 'added this to the merge queue';
        if (type === 'RemovedFromMergeQueueEvent') {
            return event.reason ? 'removed this from the merge queue: ' + oneLine(event.reason) : 'removed this from the merge queue';
        }
        if (type === 'CrossReferencedEvent') return 'cross-referenced this';
        return '';
    }

    function warnNote(text) {
        return {
            author: 'GitHub',
            created: '',
            body: text,
            html: '',
            system: true,
            file: '',
            line: '',
            resolved: null,
            tag: ''
        };
    }

    function timeOf(value) {
        var date = parseWhen(value);
        return date ? date.getTime() : 0;
    }

    function byCreated(a, b) {
        return timeOf(a && a.created) - timeOf(b && b.created);
    }

    function threadComments(thread) {
        if (thread && Array.isArray(thread._comments)) return thread._comments;
        var conn = thread && thread.comments;
        if (conn && Array.isArray(conn.nodes)) return conn.nodes;
        if (Array.isArray(conn)) return conn;
        return [];
    }

    function pushComments(notes, list) {
        if (!Array.isArray(list)) return;
        for (var i = 0; i < list.length; i++) {
            var comment = list[i];
            if (!comment) continue;
            notes.push({
                author: personName(comment.author) || 'Unknown',
                created: comment.createdAt || '',
                body: comment.body || '',
                html: comment.bodyHTML || '',
                system: false,
                file: '',
                line: '',
                resolved: null,
                tag: ''
            });
        }
    }

    function pushReviews(notes, list) {
        if (!Array.isArray(list)) return;
        for (var i = 0; i < list.length; i++) {
            var review = list[i];
            if (!review || review.state === 'PENDING') continue;
            var body = review.body || '';
            if (review.state === 'COMMENTED' && !String(body).trim()) continue;
            var html = review.bodyHTML || '';
            if (!String(body).trim()) {
                body = reviewFallback(review.state);
                html = '';
            }
            notes.push({
                author: personName(review.author) || 'Unknown',
                created: review.createdAt || '',
                body: body,
                html: html,
                system: false,
                file: '',
                line: '',
                resolved: null,
                tag: reviewTag(review.state)
            });
        }
    }

    function pushThreads(notes, list) {
        if (!Array.isArray(list)) return;
        for (var i = 0; i < list.length; i++) {
            var thread = list[i];
            if (!thread) continue;
            var comments = threadComments(thread);
            var line = thread.line || thread.originalLine || '';
            for (var j = 0; j < comments.length; j++) {
                var comment = comments[j];
                if (!comment) continue;
                notes.push({
                    author: personName(comment.author) || 'Unknown',
                    created: comment.createdAt || '',
                    body: comment.body || '',
                    html: comment.bodyHTML || '',
                    system: false,
                    file: thread.path || '',
                    line: line ? String(line) : '',
                    resolved: !!thread.isResolved,
                    tag: thread.isOutdated ? 'outdated' : ''
                });
            }
        }
    }

    function pushActivity(notes, list) {
        if (!Array.isArray(list)) return;
        for (var i = 0; i < list.length; i++) {
            var event = list[i];
            var body = activityBody(event);
            if (!body) continue;
            notes.push({
                author: personName(event && event.actor) || 'GitHub',
                created: (event && event.createdAt) || '',
                body: body,
                html: '',
                system: true,
                file: '',
                line: '',
                resolved: null,
                tag: ''
            });
        }
    }

    function buildNotes(box) {
        var notes = [];
        var source = box || {};
        var commentsOk = !!source.commentsOk;
        var reviewsOk = !!source.reviewsOk;
        var threadsOk = !!source.threadsOk;
        var activityOk = !!source.activityOk;
        if (!commentsOk && !reviewsOk && !threadsOk && !activityOk) return { notes: [], notesLoaded: false };
        if (!commentsOk) notes.push(warnNote('Conversation comments could not be loaded.'));
        if (!reviewsOk) notes.push(warnNote('Reviews could not be loaded.'));
        if (!threadsOk) notes.push(warnNote('Review comments could not be loaded.'));
        if (!activityOk) notes.push(warnNote('Activity could not be loaded.'));
        if (commentsOk) pushComments(notes, source.comments);
        if (reviewsOk) pushReviews(notes, source.reviews);
        if (threadsOk) pushThreads(notes, source.threads);
        if (activityOk) pushActivity(notes, source.activity);
        notes.sort(byCreated);
        return { notes: notes, notesLoaded: true };
    }

    function latestReviewStates(reviews) {
        var order = [];
        var byKey = {};
        var list = Array.isArray(reviews) ? reviews : [];
        for (var i = 0; i < list.length; i++) {
            var review = list[i];
            if (!review || (review.state !== 'APPROVED' && review.state !== 'CHANGES_REQUESTED')) continue;
            var login = (review.author && review.author.login) || '';
            var key = login || personName(review.author) || ('#' + i);
            if (!byKey[key]) order.push(key);
            byKey[key] = review;
        }
        var approved = [];
        var changes = [];
        for (var j = 0; j < order.length; j++) {
            var item = byKey[order[j]];
            var label = personName(item.author);
            if (!label) continue;
            if (item.state === 'APPROVED') approved.push(label);
            if (item.state === 'CHANGES_REQUESTED') changes.push(label);
        }
        return { approved: approved, changes: changes };
    }

    function reviewerNames(requests) {
        var out = [];
        if (!Array.isArray(requests)) return out;
        for (var i = 0; i < requests.length; i++) {
            var name = personName(requests[i] && requests[i].requestedReviewer);
            if (name) out.push(name);
        }
        return out;
    }

    function labelNames(list) {
        var out = [];
        if (!Array.isArray(list)) return out;
        for (var i = 0; i < list.length; i++) {
            var name = list[i] && list[i].name;
            if (name) out.push(name);
        }
        return out;
    }

    function stateLabel(pull) {
        var state = String((pull && pull.state) || '').toLowerCase();
        if (pull && pull.isDraft) return state ? 'draft (' + state + ')' : 'draft';
        return state;
    }

    function pipelineLabel(pull, origin, projectPath, number) {
        var rollup = pull && pull.statusCheckRollup;
        if (!rollup || !rollup.state) return '';
        var label = humanToken(rollup.state);
        var checks = (pull && pull.checksUrl) || '';
        if (!checks && origin && projectPath && number) checks = origin + '/' + projectPath + '/pull/' + number + '/checks';
        return checks ? label + ' ' + checks : label;
    }

    function votesLabel(pull) {
        var groups = pull && pull.reactionGroups;
        var up = 0;
        var down = 0;
        if (!Array.isArray(groups)) return '';
        for (var i = 0; i < groups.length; i++) {
            var group = groups[i] || {};
            var count = (group.reactors && group.reactors.totalCount) || 0;
            if (group.content === 'THUMBS_UP') up = count;
            else if (group.content === 'THUMBS_DOWN') down = count;
        }
        if (!up && !down) return '';
        return '+' + up + ' / -' + down;
    }

    function commitAuthor(commit) {
        var git = commit && commit.author;
        if (!git) return '';
        var name = git.name || '';
        var login = git.user && git.user.login;
        if (name && login) return name + ' (@' + login + ')';
        if (login) return '@' + login;
        return name || git.email || '';
    }

    function mapCommit(node) {
        var commit = (node && node.commit) || {};
        var oid = commit.oid || '';
        return {
            shortId: String(oid).slice(0, 8),
            title: commit.messageHeadline || '',
            author: commitAuthor(commit),
            created: commit.authoredDate || ''
        };
    }

    function mapList(list, mapper) {
        var out = [];
        if (!Array.isArray(list)) return out;
        for (var i = 0; i < list.length; i++) out.push(mapper(list[i]));
        return out;
    }

    function toSnapshot(pull, bundle, context) {
        var data = pull || {};
        var box = bundle || {};
        var ctx = context || {};
        var projectPath = ctx.projectPath || '';
        var number = String(data.number || ctx.number || '');
        var origin = ctx.origin || '';
        var reference = projectPath && number ? projectPath + '#' + number : (number ? '#' + number : '');
        var webUrl = data.url || '';
        if (!webUrl && origin && projectPath && number) webUrl = origin + '/' + projectPath + '/pull/' + number;
        var notes = buildNotes(box);
        var decisions = latestReviewStates(box.reviewsOk ? box.reviews : []);
        var commits = box.commitsOk ? mapList(box.commits, mapCommit) : [];
        commits.sort(byCreated);
        return {
            reference: reference,
            number: number,
            iid: number,
            projectPath: projectPath,
            url: webUrl,
            fetchedAt: new Date().toISOString(),
            title: data.title || '',
            description: data.body || '',
            descriptionHtml: data.bodyHTML || '',
            state: stateLabel(data),
            author: personName(data.author),
            assignees: peopleList(box.assignees),
            reviewers: reviewerNames(box.reviewRequests),
            approvedBy: decisions.approved,
            changesRequestedBy: decisions.changes,
            labels: labelNames(box.labels),
            milestone: data.milestone ? (data.milestone.title || '') : '',
            sourceBranch: data.headRefName || '',
            targetBranch: data.baseRefName || '',
            created: data.createdAt || '',
            updated: data.updatedAt || '',
            merged: data.mergedAt || '',
            closed: data.closedAt || '',
            mergeStatus: humanToken(data.mergeStateStatus || ''),
            reviewDecision: humanToken(data.reviewDecision || ''),
            sha: data.headRefOid || '',
            pipeline: pipelineLabel(data, origin, projectPath, number),
            timeEstimate: '',
            timeSpent: '',
            votes: votesLabel(data),
            notes: notes.notes,
            notesLoaded: notes.notesLoaded,
            commits: commits,
            commitsLoaded: !!box.commitsOk
        };
    }

    function fetchSnapshot(pr) {
        return gql(pr.origin, CORE_QUERY, {
            owner: pr.owner,
            name: pr.repo,
            number: Number(pr.number)
        }).then(function (data) {
            var pull = pullFromData(data);
            return Promise.all([
                soft(fetchPrPages(pr, ASSIGNEES_FIELD, function (item) { return item.assignees; }), 'assignees'),
                soft(fetchPrPages(pr, REVIEW_REQUESTS_FIELD, function (item) { return item.reviewRequests; }), 'reviewers'),
                soft(fetchPrPages(pr, LABELS_FIELD, function (item) { return item.labels; }), 'labels'),
                soft(fetchPrPages(pr, COMMENTS_FIELD, function (item) { return item.comments; }), 'comments'),
                soft(fetchPrPages(pr, REVIEWS_FIELD, function (item) { return item.reviews; }), 'reviews'),
                soft(fetchThreads(pr), 'threads'),
                soft(fetchPrPages(pr, COMMITS_FIELD, function (item) { return item.commits; }), 'commits'),
                soft(fetchPrPages(pr, ACTIVITY_FIELD, function (item) { return item.timelineItems; }), 'activity')
            ]).then(function (parts) {
                return toSnapshot(pull, {
                    assignees: parts[0].ok ? parts[0].value : [],
                    reviewRequests: parts[1].ok ? parts[1].value : [],
                    labels: parts[2].ok ? parts[2].value : [],
                    comments: parts[3].ok ? parts[3].value : [],
                    reviews: parts[4].ok ? parts[4].value : [],
                    threads: parts[5].ok ? parts[5].value : [],
                    commits: parts[6].ok ? parts[6].value : [],
                    activity: parts[7].ok ? parts[7].value : [],
                    commentsOk: parts[3].ok,
                    reviewsOk: parts[4].ok,
                    threadsOk: parts[5].ok,
                    commitsOk: parts[6].ok,
                    activityOk: parts[7].ok
                }, pr);
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

    // project_path_PR<number>_YYYYMMDD_HHMM from the pull request's updated time, in local time.
    function downloadBaseName(snap) {
        var project = safeToken(snap && snap.projectPath) || 'project';
        var number = String((snap && (snap.number || snap.iid)) || 'pr').replace(/[^\w.-]+/g, '');
        var date = parseWhen(snap && snap.updated) || parseWhen(snap && snap.fetchedAt) || new Date();
        return project + '_PR' + number + '_' + fileStamp(date);
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
            ['Changes requested by', joinList(snap.changesRequestedBy)],
            ['Source branch', snap.sourceBranch],
            ['Target branch', snap.targetBranch],
            ['Labels', joinList(snap.labels)],
            ['Milestone', snap.milestone],
            ['Created', formatWhen(snap.created)],
            ['Updated', formatWhen(snap.updated)],
            ['Merged', formatWhen(snap.merged)],
            ['Closed', formatWhen(snap.closed)],
            ['Merge status', snap.mergeStatus],
            ['Review decision', snap.reviewDecision],
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

    function noteBits(note) {
        var bits = [note.author || 'Unknown'];
        var when = formatWhen(note.created);
        if (when) bits.push(when);
        var where = noteLocation(note);
        if (where) bits.push(where);
        if (note.tag) bits.push(note.tag);
        var resolved = resolvedLabel(note);
        if (resolved) bits.push(resolved);
        if (note.system) bits.push('activity');
        return bits;
    }

    var CSS = [
        'body { margin: 0; background: #fafaf7; color: #1c1c1c; font: 16px/1.5 Georgia, "Iowan Old Style", Palatino, serif; }',
        'main { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }',
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
        'pre { background: #f0f0ea; padding: 12px; overflow: auto; white-space: pre-wrap; }',
        'blockquote { border-left: 3px solid #ccc; margin: 12px 0; padding-left: 12px; color: #333; }',
        'img { max-width: 100%; height: auto; }',
        '.note { border-top: 1px solid #e4e4dc; padding: 12px 0; }',
        '.note.system { color: #333; }',
        '.meta { font-size: 13px; color: #5c5c5c; margin: 0 0 8px; }',
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
            '<title>' + escapeHtml(heading || 'Pull request') + '</title>\n<style>\n' + CSS + '\n</style>\n</head>\n<body>\n<main>\n' +
            '<p class="key">' + escapeHtml(snap.reference || '') + '</p>\n' +
            '<h1>' + escapeHtml(snap.title || snap.reference || 'Pull request') + '</h1>\n' +
            (snap.url ? '<p class="source"><a href="' + escapeHtml(snap.url) + '">' + escapeHtml(snap.url) + '</a></p>\n' : '') +
            meta +
            '<h2>Description</h2>\n<div class="description">' + description + '</div>\n' +
            '<h2>Notes</h2>\n' + notesHtml(snap, origin) + '\n' +
            '<h2>Commits</h2>\n' + commitsHtml(snap) + '\n' +
            '<footer>Saved ' + escapeHtml(formatWhen(snap.fetchedAt)) + '</footer>\n' +
            '</main>\n</body>\n</html>\n';
    }

    function notesHtml(snap, origin) {
        if (!snap.notesLoaded) return '<p class="empty">Notes could not be loaded.</p>';
        if (!snap.notes.length) return '<p class="empty">No notes.</p>';
        var html = '';
        for (var i = 0; i < snap.notes.length; i++) {
            var note = snap.notes[i];
            var body = richHtml(note.html, note.body, origin);
            if (!body) body = '<p class="empty">No note body.</p>';
            html += '<article class="note' + (note.system ? ' system' : '') + '"><p class="meta">' +
                escapeHtml(noteBits(note).join(' — ')) + '</p>' + body + '</article>';
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

    function cellPipe(value) {
        return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
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
        var lines = ['# ' + (heading || 'Pull request'), ''];
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

    function notesMarkdown(snap, origin) {
        if (!snap.notesLoaded || !snap.notes.length) return '';
        var blocks = [];
        for (var i = 0; i < snap.notes.length; i++) {
            var note = snap.notes[i];
            var title = (note.author || 'Unknown');
            var when = formatWhen(note.created);
            if (when) title += ' — ' + when;
            var where = noteLocation(note);
            if (where) title += ' — `' + where.replace(/`/g, '\\`') + '`';
            if (note.tag) title += ' — ' + note.tag;
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
                console.log('[GIT-PR] plain download triggered:', filename);
            }
            if (typeof GM_download === 'function' && text.length < 1500000) {
                console.log('[GIT-PR] using GM_download:', savedAs);
                GM_download({
                    url: 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text),
                    name: savedAs,
                    saveAs: false,
                    onload: function () {
                        console.log('[GIT-PR] GM_download finished', savedAs);
                        cleanup();
                        resolve();
                    },
                    onerror: function (err) {
                        console.log('[GIT-PR] GM_download failed, falling back', err);
                        try {
                            plainDownload();
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    }
                });
            } else {
                console.log('[GIT-PR] using plain download for', savedAs);
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
        var pr = prFromUrl(location.href);
        if (!pr || btn.disabled) return;
        setBusy(true);
        btn.textContent = 'saving…';
        console.log('[GIT-PR] download clicked', kind, pr.projectPath + '#' + pr.number);
        fetchSnapshot(pr).then(function (snap) {
            var markdown = kind === 'md';
            var body = markdown ? renderMarkdown(snap) : renderHtml(snap);
            var filename = downloadBaseName(snap) + (markdown ? '.md' : '.html');
            var mime = markdown ? 'text/markdown' : 'text/html';
            return downloadText(body, filename, mime, kind).then(function () {
                console.log('[GIT-PR] saved', downloadDir(kind) + '/' + filename);
                flash(btn, 'saved');
            });
        }).catch(function (err) {
            var reason = messageFor(err);
            console.log('[GIT-PR] download FAILED:', reason, err);
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
        var pr = prFromUrl(location.href);
        var bar = document.getElementById(BAR_ID);
        if (!pr) {
            if (bar) bar.remove();
            return;
        }
        if (!document.body) return;
        var key = pr.projectPath + '#' + pr.number;
        if (bar) {
            bar.setAttribute('data-pr', key);
            return;
        }
        bar = document.createElement('div');
        bar.id = BAR_ID;
        bar.setAttribute('data-pr', key);
        bar.style.position = 'fixed';
        bar.style.right = '16px';
        bar.style.bottom = '16px';
        bar.style.zIndex = '99999';
        bar.style.display = 'flex';
        bar.style.gap = '8px';
        bar.appendChild(makeButton('Download HTML', 'html'));
        bar.appendChild(makeButton('Download Markdown', 'md'));
        document.body.appendChild(bar);
        console.log('[GIT-PR] button inserted for', key);
    }

    function maybeStart() {
        if (typeof document === 'undefined' || !document.documentElement || typeof location === 'undefined') return;
        var href = location.href;
        var onPr = /\/pull\/\d+/.test(href);
        if (!orgConfigured()) {
            if (onPr) console.log('[GIT-PR] edit git_ui_url_organization (host only) before this page can match');
            return;
        }
        if (!startsWithOrg(href, git_ui_url_organization)) {
            if (onPr) console.log('[GIT-PR] page does not start with https://' + normalizeOrg(git_ui_url_organization));
            return;
        }
        console.log('[GIT-PR] script started (v1.0.0) on', href);
        setInterval(ensureBar, 1000);
        if (document.body) ensureBar();
        else document.addEventListener('DOMContentLoaded', ensureBar);
    }

    if (typeof document !== 'undefined') maybeStart();

    if (typeof document === 'undefined' && typeof module !== 'undefined' && module && module.exports) {
        module.exports = {
            normalizeOrg: normalizeOrg,
            startsWithOrg: startsWithOrg,
            prFromUrl: prFromUrl,
            toSnapshot: toSnapshot,
            sanitizeHtml: sanitizeHtml,
            renderHtml: renderHtml,
            renderMarkdown: renderMarkdown,
            messageFor: messageFor,
            downloadBaseName: downloadBaseName,
            downloadDir: downloadDir,
            absolutizeMarkdown: absolutizeMarkdown,
            activityBody: activityBody,
            graphqlQueries: graphqlQueries
        };
    }
})();
