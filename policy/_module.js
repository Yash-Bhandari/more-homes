function noop() { }
const identity = x => x;
function assign(tar, src) {
    // @ts-ignore
    for (const k in src)
        tar[k] = src[k];
    return tar;
}
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
let src_url_equal_anchor;
function src_url_equal(element_src, url) {
    if (!src_url_equal_anchor) {
        src_url_equal_anchor = document.createElement('a');
    }
    src_url_equal_anchor.href = url;
    return element_src === src_url_equal_anchor.href;
}
function is_empty(obj) {
    return Object.keys(obj).length === 0;
}
function exclude_internal_props(props) {
    const result = {};
    for (const k in props)
        if (k[0] !== '$')
            result[k] = props[k];
    return result;
}

const is_client = typeof window !== 'undefined';
let now = is_client
    ? () => window.performance.now()
    : () => Date.now();
let raf = is_client ? cb => requestAnimationFrame(cb) : noop;

const tasks = new Set();
function run_tasks(now) {
    tasks.forEach(task => {
        if (!task.c(now)) {
            tasks.delete(task);
            task.f();
        }
    });
    if (tasks.size !== 0)
        raf(run_tasks);
}
/**
 * Creates a new task that runs on each raf frame
 * until it returns a falsy value or is aborted
 */
function loop(callback) {
    let task;
    if (tasks.size === 0)
        raf(run_tasks);
    return {
        promise: new Promise(fulfill => {
            tasks.add(task = { c: callback, f: fulfill });
        }),
        abort() {
            tasks.delete(task);
        }
    };
}

// Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
// at the end of hydration without touching the remaining nodes.
let is_hydrating = false;
function start_hydrating() {
    is_hydrating = true;
}
function end_hydrating() {
    is_hydrating = false;
}
function upper_bound(low, high, key, value) {
    // Return first index of value larger than input value in the range [low, high)
    while (low < high) {
        const mid = low + ((high - low) >> 1);
        if (key(mid) <= value) {
            low = mid + 1;
        }
        else {
            high = mid;
        }
    }
    return low;
}
function init_hydrate(target) {
    if (target.hydrate_init)
        return;
    target.hydrate_init = true;
    // We know that all children have claim_order values since the unclaimed have been detached if target is not <head>
    let children = target.childNodes;
    // If target is <head>, there may be children without claim_order
    if (target.nodeName === 'HEAD') {
        const myChildren = [];
        for (let i = 0; i < children.length; i++) {
            const node = children[i];
            if (node.claim_order !== undefined) {
                myChildren.push(node);
            }
        }
        children = myChildren;
    }
    /*
    * Reorder claimed children optimally.
    * We can reorder claimed children optimally by finding the longest subsequence of
    * nodes that are already claimed in order and only moving the rest. The longest
    * subsequence of nodes that are claimed in order can be found by
    * computing the longest increasing subsequence of .claim_order values.
    *
    * This algorithm is optimal in generating the least amount of reorder operations
    * possible.
    *
    * Proof:
    * We know that, given a set of reordering operations, the nodes that do not move
    * always form an increasing subsequence, since they do not move among each other
    * meaning that they must be already ordered among each other. Thus, the maximal
    * set of nodes that do not move form a longest increasing subsequence.
    */
    // Compute longest increasing subsequence
    // m: subsequence length j => index k of smallest value that ends an increasing subsequence of length j
    const m = new Int32Array(children.length + 1);
    // Predecessor indices + 1
    const p = new Int32Array(children.length);
    m[0] = -1;
    let longest = 0;
    for (let i = 0; i < children.length; i++) {
        const current = children[i].claim_order;
        // Find the largest subsequence length such that it ends in a value less than our current value
        // upper_bound returns first greater value, so we subtract one
        // with fast path for when we are on the current longest subsequence
        const seqLen = ((longest > 0 && children[m[longest]].claim_order <= current) ? longest + 1 : upper_bound(1, longest, idx => children[m[idx]].claim_order, current)) - 1;
        p[i] = m[seqLen] + 1;
        const newLen = seqLen + 1;
        // We can guarantee that current is the smallest value. Otherwise, we would have generated a longer sequence.
        m[newLen] = i;
        longest = Math.max(newLen, longest);
    }
    // The longest increasing subsequence of nodes (initially reversed)
    const lis = [];
    // The rest of the nodes, nodes that will be moved
    const toMove = [];
    let last = children.length - 1;
    for (let cur = m[longest] + 1; cur != 0; cur = p[cur - 1]) {
        lis.push(children[cur - 1]);
        for (; last >= cur; last--) {
            toMove.push(children[last]);
        }
        last--;
    }
    for (; last >= 0; last--) {
        toMove.push(children[last]);
    }
    lis.reverse();
    // We sort the nodes being moved to guarantee that their insertion order matches the claim order
    toMove.sort((a, b) => a.claim_order - b.claim_order);
    // Finally, we move the nodes
    for (let i = 0, j = 0; i < toMove.length; i++) {
        while (j < lis.length && toMove[i].claim_order >= lis[j].claim_order) {
            j++;
        }
        const anchor = j < lis.length ? lis[j] : null;
        target.insertBefore(toMove[i], anchor);
    }
}
function append(target, node) {
    target.appendChild(node);
}
function get_root_for_style(node) {
    if (!node)
        return document;
    const root = node.getRootNode ? node.getRootNode() : node.ownerDocument;
    if (root && root.host) {
        return root;
    }
    return node.ownerDocument;
}
function append_empty_stylesheet(node) {
    const style_element = element('style');
    append_stylesheet(get_root_for_style(node), style_element);
    return style_element.sheet;
}
function append_stylesheet(node, style) {
    append(node.head || node, style);
    return style.sheet;
}
function append_hydration(target, node) {
    if (is_hydrating) {
        init_hydrate(target);
        if ((target.actual_end_child === undefined) || ((target.actual_end_child !== null) && (target.actual_end_child.parentNode !== target))) {
            target.actual_end_child = target.firstChild;
        }
        // Skip nodes of undefined ordering
        while ((target.actual_end_child !== null) && (target.actual_end_child.claim_order === undefined)) {
            target.actual_end_child = target.actual_end_child.nextSibling;
        }
        if (node !== target.actual_end_child) {
            // We only insert if the ordering of this node should be modified or the parent node is not target
            if (node.claim_order !== undefined || node.parentNode !== target) {
                target.insertBefore(node, target.actual_end_child);
            }
        }
        else {
            target.actual_end_child = node.nextSibling;
        }
    }
    else if (node.parentNode !== target || node.nextSibling !== null) {
        target.appendChild(node);
    }
}
function insert_hydration(target, node, anchor) {
    if (is_hydrating && !anchor) {
        append_hydration(target, node);
    }
    else if (node.parentNode !== target || node.nextSibling != anchor) {
        target.insertBefore(node, anchor || null);
    }
}
function detach(node) {
    if (node.parentNode) {
        node.parentNode.removeChild(node);
    }
}
function destroy_each(iterations, detaching) {
    for (let i = 0; i < iterations.length; i += 1) {
        if (iterations[i])
            iterations[i].d(detaching);
    }
}
function element(name) {
    return document.createElement(name);
}
function svg_element(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function empty() {
    return text('');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
/**
 * List of attributes that should always be set through the attr method,
 * because updating them through the property setter doesn't work reliably.
 * In the example of `width`/`height`, the problem is that the setter only
 * accepts numeric values, but the attribute can also be set to a string like `50%`.
 * If this list becomes too big, rethink this approach.
 */
const always_set_through_set_attribute = ['width', 'height'];
function set_attributes(node, attributes) {
    // @ts-ignore
    const descriptors = Object.getOwnPropertyDescriptors(node.__proto__);
    for (const key in attributes) {
        if (attributes[key] == null) {
            node.removeAttribute(key);
        }
        else if (key === 'style') {
            node.style.cssText = attributes[key];
        }
        else if (key === '__value') {
            node.value = node[key] = attributes[key];
        }
        else if (descriptors[key] && descriptors[key].set && always_set_through_set_attribute.indexOf(key) === -1) {
            node[key] = attributes[key];
        }
        else {
            attr(node, key, attributes[key]);
        }
    }
}
function set_svg_attributes(node, attributes) {
    for (const key in attributes) {
        attr(node, key, attributes[key]);
    }
}
function children(element) {
    return Array.from(element.childNodes);
}
function init_claim_info(nodes) {
    if (nodes.claim_info === undefined) {
        nodes.claim_info = { last_index: 0, total_claimed: 0 };
    }
}
function claim_node(nodes, predicate, processNode, createNode, dontUpdateLastIndex = false) {
    // Try to find nodes in an order such that we lengthen the longest increasing subsequence
    init_claim_info(nodes);
    const resultNode = (() => {
        // We first try to find an element after the previous one
        for (let i = nodes.claim_info.last_index; i < nodes.length; i++) {
            const node = nodes[i];
            if (predicate(node)) {
                const replacement = processNode(node);
                if (replacement === undefined) {
                    nodes.splice(i, 1);
                }
                else {
                    nodes[i] = replacement;
                }
                if (!dontUpdateLastIndex) {
                    nodes.claim_info.last_index = i;
                }
                return node;
            }
        }
        // Otherwise, we try to find one before
        // We iterate in reverse so that we don't go too far back
        for (let i = nodes.claim_info.last_index - 1; i >= 0; i--) {
            const node = nodes[i];
            if (predicate(node)) {
                const replacement = processNode(node);
                if (replacement === undefined) {
                    nodes.splice(i, 1);
                }
                else {
                    nodes[i] = replacement;
                }
                if (!dontUpdateLastIndex) {
                    nodes.claim_info.last_index = i;
                }
                else if (replacement === undefined) {
                    // Since we spliced before the last_index, we decrease it
                    nodes.claim_info.last_index--;
                }
                return node;
            }
        }
        // If we can't find any matching node, we create a new one
        return createNode();
    })();
    resultNode.claim_order = nodes.claim_info.total_claimed;
    nodes.claim_info.total_claimed += 1;
    return resultNode;
}
function claim_element_base(nodes, name, attributes, create_element) {
    return claim_node(nodes, (node) => node.nodeName === name, (node) => {
        const remove = [];
        for (let j = 0; j < node.attributes.length; j++) {
            const attribute = node.attributes[j];
            if (!attributes[attribute.name]) {
                remove.push(attribute.name);
            }
        }
        remove.forEach(v => node.removeAttribute(v));
        return undefined;
    }, () => create_element(name));
}
function claim_element(nodes, name, attributes) {
    return claim_element_base(nodes, name, attributes, element);
}
function claim_svg_element(nodes, name, attributes) {
    return claim_element_base(nodes, name, attributes, svg_element);
}
function claim_text(nodes, data) {
    return claim_node(nodes, (node) => node.nodeType === 3, (node) => {
        const dataStr = '' + data;
        if (node.data.startsWith(dataStr)) {
            if (node.data.length !== dataStr.length) {
                return node.splitText(dataStr.length);
            }
        }
        else {
            node.data = dataStr;
        }
    }, () => text(data), true // Text nodes should not update last index since it is likely not worth it to eliminate an increasing subsequence of actual elements
    );
}
function claim_space(nodes) {
    return claim_text(nodes, ' ');
}
function set_data(text, data) {
    data = '' + data;
    if (text.data === data)
        return;
    text.data = data;
}
function toggle_class(element, name, toggle) {
    element.classList[toggle ? 'add' : 'remove'](name);
}
function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, bubbles, cancelable, detail);
    return e;
}
function head_selector(nodeId, head) {
    const result = [];
    let started = 0;
    for (const node of head.childNodes) {
        if (node.nodeType === 8 /* comment node */) {
            const comment = node.textContent.trim();
            if (comment === `HEAD_${nodeId}_END`) {
                started -= 1;
                result.push(node);
            }
            else if (comment === `HEAD_${nodeId}_START`) {
                started += 1;
                result.push(node);
            }
        }
        else if (started > 0) {
            result.push(node);
        }
    }
    return result;
}

// we need to store the information for multiple documents because a Svelte application could also contain iframes
// https://github.com/sveltejs/svelte/issues/3624
const managed_styles = new Map();
let active = 0;
// https://github.com/darkskyapp/string-hash/blob/master/index.js
function hash(str) {
    let hash = 5381;
    let i = str.length;
    while (i--)
        hash = ((hash << 5) - hash) ^ str.charCodeAt(i);
    return hash >>> 0;
}
function create_style_information(doc, node) {
    const info = { stylesheet: append_empty_stylesheet(node), rules: {} };
    managed_styles.set(doc, info);
    return info;
}
function create_rule(node, a, b, duration, delay, ease, fn, uid = 0) {
    const step = 16.666 / duration;
    let keyframes = '{\n';
    for (let p = 0; p <= 1; p += step) {
        const t = a + (b - a) * ease(p);
        keyframes += p * 100 + `%{${fn(t, 1 - t)}}\n`;
    }
    const rule = keyframes + `100% {${fn(b, 1 - b)}}\n}`;
    const name = `__svelte_${hash(rule)}_${uid}`;
    const doc = get_root_for_style(node);
    const { stylesheet, rules } = managed_styles.get(doc) || create_style_information(doc, node);
    if (!rules[name]) {
        rules[name] = true;
        stylesheet.insertRule(`@keyframes ${name} ${rule}`, stylesheet.cssRules.length);
    }
    const animation = node.style.animation || '';
    node.style.animation = `${animation ? `${animation}, ` : ''}${name} ${duration}ms linear ${delay}ms 1 both`;
    active += 1;
    return name;
}
function delete_rule(node, name) {
    const previous = (node.style.animation || '').split(', ');
    const next = previous.filter(name
        ? anim => anim.indexOf(name) < 0 // remove specific animation
        : anim => anim.indexOf('__svelte') === -1 // remove all Svelte animations
    );
    const deleted = previous.length - next.length;
    if (deleted) {
        node.style.animation = next.join(', ');
        active -= deleted;
        if (!active)
            clear_rules();
    }
}
function clear_rules() {
    raf(() => {
        if (active)
            return;
        managed_styles.forEach(info => {
            const { ownerNode } = info.stylesheet;
            // there is no ownerNode if it runs on jsdom.
            if (ownerNode)
                detach(ownerNode);
        });
        managed_styles.clear();
    });
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error('Function called outside component initialization');
    return current_component;
}
/**
 * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
 * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
 * it can be called from an external module).
 *
 * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
 *
 * https://svelte.dev/docs#run-time-svelte-onmount
 */
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
/**
 * Schedules a callback to run immediately before the component is unmounted.
 *
 * Out of `onMount`, `beforeUpdate`, `afterUpdate` and `onDestroy`, this is the
 * only one that runs inside a server-side component.
 *
 * https://svelte.dev/docs#run-time-svelte-ondestroy
 */
function onDestroy(fn) {
    get_current_component().$$.on_destroy.push(fn);
}
/**
 * Creates an event dispatcher that can be used to dispatch [component events](/docs#template-syntax-component-directives-on-eventname).
 * Event dispatchers are functions that can take two arguments: `name` and `detail`.
 *
 * Component events created with `createEventDispatcher` create a
 * [CustomEvent](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent).
 * These events do not [bubble](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#Event_bubbling_and_capture).
 * The `detail` argument corresponds to the [CustomEvent.detail](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/detail)
 * property and can contain any type of data.
 *
 * https://svelte.dev/docs#run-time-svelte-createeventdispatcher
 */
function createEventDispatcher() {
    const component = get_current_component();
    return (type, detail, { cancelable = false } = {}) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail, { cancelable });
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
            return !event.defaultPrevented;
        }
        return true;
    };
}

const dirty_components = [];
const binding_callbacks = [];
let render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = /* @__PURE__ */ Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
// flush() calls callbacks in this order:
// 1. All beforeUpdate callbacks, in order: parents before children
// 2. All bind:this callbacks, in reverse order: children before parents.
// 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
//    for afterUpdates called during the initial onMount, which are called in
//    reverse order: children before parents.
// Since callbacks might update component values, which could trigger another
// call to flush(), the following steps guard against this:
// 1. During beforeUpdate, any updated components will be added to the
//    dirty_components array and will cause a reentrant call to flush(). Because
//    the flush index is kept outside the function, the reentrant call will pick
//    up where the earlier call left off and go through all dirty components. The
//    current_component value is saved and restored so that the reentrant call will
//    not interfere with the "parent" flush() call.
// 2. bind:this callbacks cannot trigger new flush() calls.
// 3. During afterUpdate, any updated components will NOT have their afterUpdate
//    callback called a second time; the seen_callbacks set, outside the flush()
//    function, guarantees this behavior.
const seen_callbacks = new Set();
let flushidx = 0; // Do *not* move this inside the flush() function
function flush() {
    // Do not reenter flush while dirty components are updated, as this can
    // result in an infinite loop. Instead, let the inner flush handle it.
    // Reentrancy is ok afterwards for bindings etc.
    if (flushidx !== 0) {
        return;
    }
    const saved_component = current_component;
    do {
        // first, call beforeUpdate functions
        // and update components
        try {
            while (flushidx < dirty_components.length) {
                const component = dirty_components[flushidx];
                flushidx++;
                set_current_component(component);
                update(component.$$);
            }
        }
        catch (e) {
            // reset dirty state to not end up in a deadlocked state and then rethrow
            dirty_components.length = 0;
            flushidx = 0;
            throw e;
        }
        set_current_component(null);
        dirty_components.length = 0;
        flushidx = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    seen_callbacks.clear();
    set_current_component(saved_component);
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
/**
 * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
 */
function flush_render_callbacks(fns) {
    const filtered = [];
    const targets = [];
    render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
    targets.forEach((c) => c());
    render_callbacks = filtered;
}

let promise;
function wait() {
    if (!promise) {
        promise = Promise.resolve();
        promise.then(() => {
            promise = null;
        });
    }
    return promise;
}
function dispatch(node, direction, kind) {
    node.dispatchEvent(custom_event(`${direction ? 'intro' : 'outro'}${kind}`));
}
const outroing = new Set();
let outros;
function group_outros() {
    outros = {
        r: 0,
        c: [],
        p: outros // parent group
    };
}
function check_outros() {
    if (!outros.r) {
        run_all(outros.c);
    }
    outros = outros.p;
}
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function transition_out(block, local, detach, callback) {
    if (block && block.o) {
        if (outroing.has(block))
            return;
        outroing.add(block);
        outros.c.push(() => {
            outroing.delete(block);
            if (callback) {
                if (detach)
                    block.d(1);
                callback();
            }
        });
        block.o(local);
    }
    else if (callback) {
        callback();
    }
}
const null_transition = { duration: 0 };
function create_bidirectional_transition(node, fn, params, intro) {
    const options = { direction: 'both' };
    let config = fn(node, params, options);
    let t = intro ? 0 : 1;
    let running_program = null;
    let pending_program = null;
    let animation_name = null;
    function clear_animation() {
        if (animation_name)
            delete_rule(node, animation_name);
    }
    function init(program, duration) {
        const d = (program.b - t);
        duration *= Math.abs(d);
        return {
            a: t,
            b: program.b,
            d,
            duration,
            start: program.start,
            end: program.start + duration,
            group: program.group
        };
    }
    function go(b) {
        const { delay = 0, duration = 300, easing = identity, tick = noop, css } = config || null_transition;
        const program = {
            start: now() + delay,
            b
        };
        if (!b) {
            // @ts-ignore todo: improve typings
            program.group = outros;
            outros.r += 1;
        }
        if (running_program || pending_program) {
            pending_program = program;
        }
        else {
            // if this is an intro, and there's a delay, we need to do
            // an initial tick and/or apply CSS animation immediately
            if (css) {
                clear_animation();
                animation_name = create_rule(node, t, b, duration, delay, easing, css);
            }
            if (b)
                tick(0, 1);
            running_program = init(program, duration);
            add_render_callback(() => dispatch(node, b, 'start'));
            loop(now => {
                if (pending_program && now > pending_program.start) {
                    running_program = init(pending_program, duration);
                    pending_program = null;
                    dispatch(node, running_program.b, 'start');
                    if (css) {
                        clear_animation();
                        animation_name = create_rule(node, t, running_program.b, running_program.duration, 0, easing, config.css);
                    }
                }
                if (running_program) {
                    if (now >= running_program.end) {
                        tick(t = running_program.b, 1 - t);
                        dispatch(node, running_program.b, 'end');
                        if (!pending_program) {
                            // we're done
                            if (running_program.b) {
                                // intro — we can tidy up immediately
                                clear_animation();
                            }
                            else {
                                // outro — needs to be coordinated
                                if (!--running_program.group.r)
                                    run_all(running_program.group.c);
                            }
                        }
                        running_program = null;
                    }
                    else if (now >= running_program.start) {
                        const p = now - running_program.start;
                        t = running_program.a + running_program.d * easing(p / running_program.duration);
                        tick(t, 1 - t);
                    }
                }
                return !!(running_program || pending_program);
            });
        }
    }
    return {
        run(b) {
            if (is_function(config)) {
                wait().then(() => {
                    // @ts-ignore
                    config = config(options);
                    go(b);
                });
            }
            else {
                go(b);
            }
        },
        end() {
            clear_animation();
            running_program = pending_program = null;
        }
    };
}
function outro_and_destroy_block(block, lookup) {
    transition_out(block, 1, 1, () => {
        lookup.delete(block.key);
    });
}
function update_keyed_each(old_blocks, dirty, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block, next, get_context) {
    let o = old_blocks.length;
    let n = list.length;
    let i = o;
    const old_indexes = {};
    while (i--)
        old_indexes[old_blocks[i].key] = i;
    const new_blocks = [];
    const new_lookup = new Map();
    const deltas = new Map();
    const updates = [];
    i = n;
    while (i--) {
        const child_ctx = get_context(ctx, list, i);
        const key = get_key(child_ctx);
        let block = lookup.get(key);
        if (!block) {
            block = create_each_block(key, child_ctx);
            block.c();
        }
        else if (dynamic) {
            // defer updates until all the DOM shuffling is done
            updates.push(() => block.p(child_ctx, dirty));
        }
        new_lookup.set(key, new_blocks[i] = block);
        if (key in old_indexes)
            deltas.set(key, Math.abs(i - old_indexes[key]));
    }
    const will_move = new Set();
    const did_move = new Set();
    function insert(block) {
        transition_in(block, 1);
        block.m(node, next);
        lookup.set(block.key, block);
        next = block.first;
        n--;
    }
    while (o && n) {
        const new_block = new_blocks[n - 1];
        const old_block = old_blocks[o - 1];
        const new_key = new_block.key;
        const old_key = old_block.key;
        if (new_block === old_block) {
            // do nothing
            next = new_block.first;
            o--;
            n--;
        }
        else if (!new_lookup.has(old_key)) {
            // remove old block
            destroy(old_block, lookup);
            o--;
        }
        else if (!lookup.has(new_key) || will_move.has(new_key)) {
            insert(new_block);
        }
        else if (did_move.has(old_key)) {
            o--;
        }
        else if (deltas.get(new_key) > deltas.get(old_key)) {
            did_move.add(new_key);
            insert(new_block);
        }
        else {
            will_move.add(old_key);
            o--;
        }
    }
    while (o--) {
        const old_block = old_blocks[o];
        if (!new_lookup.has(old_block.key))
            destroy(old_block, lookup);
    }
    while (n)
        insert(new_blocks[n - 1]);
    run_all(updates);
    return new_blocks;
}

function get_spread_update(levels, updates) {
    const update = {};
    const to_null_out = {};
    const accounted_for = { $$scope: 1 };
    let i = levels.length;
    while (i--) {
        const o = levels[i];
        const n = updates[i];
        if (n) {
            for (const key in o) {
                if (!(key in n))
                    to_null_out[key] = 1;
            }
            for (const key in n) {
                if (!accounted_for[key]) {
                    update[key] = n[key];
                    accounted_for[key] = 1;
                }
            }
            levels[i] = n;
        }
        else {
            for (const key in o) {
                accounted_for[key] = 1;
            }
        }
    }
    for (const key in to_null_out) {
        if (!(key in update))
            update[key] = undefined;
    }
    return update;
}
function create_component(block) {
    block && block.c();
}
function claim_component(block, parent_nodes) {
    block && block.l(parent_nodes);
}
function mount_component(component, target, anchor, customElement) {
    const { fragment, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    if (!customElement) {
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
            // if the component was destroyed immediately
            // it will update the `$$.on_destroy` reference to `null`.
            // the destructured on_destroy may still reference to the old array
            if (component.$$.on_destroy) {
                component.$$.on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
    }
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        flush_render_callbacks($$.after_update);
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const $$ = component.$$ = {
        fragment: null,
        ctx: [],
        // state
        props,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        on_disconnect: [],
        before_update: [],
        after_update: [],
        context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
        // everything else
        callbacks: blank_object(),
        dirty,
        skip_bound: false,
        root: options.target || parent_component.$$.root
    };
    append_styles && append_styles($$.root);
    let ready = false;
    $$.ctx = instance
        ? instance(component, options.props || {}, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if (!$$.skip_bound && $$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            start_hydrating();
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor, options.customElement);
        end_hydrating();
        flush();
    }
    set_current_component(parent_component);
}
/**
 * Base class for Svelte components. Used when dev=false.
 */
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        if (!is_function(callback)) {
            return noop;
        }
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set($$props) {
        if (this.$$set && !is_empty($$props)) {
            this.$$.skip_bound = true;
            this.$$set($$props);
            this.$$.skip_bound = false;
        }
    }
}

/* generated by Svelte v3.58.0 */

function create_fragment(ctx) {
	let link;
	let link_href_value;
	let title_value;
	let meta0;
	let meta1;
	let script0;
	let script0_src_value;
	let script1;
	let t0;
	let style;
	let t1;
	document.title = title_value = /*title*/ ctx[0];

	return {
		c() {
			link = element("link");
			meta0 = element("meta");
			meta1 = element("meta");
			script0 = element("script");
			script1 = element("script");
			t0 = text("(function(w,d,e,u,f,l,n){w[f]=w[f]||function(){(w[f].q=w[f].q||[])\n    .push(arguments);},l=d.createElement(e),l.async=1,l.src=u,\n    n=d.getElementsByTagName(e)[0],n.parentNode.insertBefore(l,n);})\n    (window,document,'script','https://assets.mailerlite.com/js/universal.js','ml');\n    ml('account', '714042');\n");
			style = element("style");
			t1 = text("@import url(\"https://unpkg.com/@primo-app/primo@1.3.64/reset.css\");\n@import url('https://fonts.googleapis.com/css2?family=Lexend&display=swap');\n\n#page {\n  --max-width: 740px;\n  /* --color-accent: #FF0000; Beware, we look like the LPC with a red theme on*/ \n  --color-accent: rebeccapurple;\n  font-family: lexend, system-ui, sans-serif;\n  color: var(--color);\n  line-height: 1.6; \n  font-size: 1rem;\n  background: var(--background);\n}\n\n.section-container {\n  max-width: var(--max-width, 1000px);\n  margin: 0 auto;\n  padding: 3rem var(--padding, 1rem); \n}\n\n.heading {\n  font-size: 3rem;\n  line-height: 1;\n  font-weight: 700;\n  margin: 0;\n}\n\na {\n  color: var(--color-accent);\n}\n\n.link {\n  color: var(--color-accent);\n}\n\na:hover {\n  text-decoration: underline;\n  font-weight: bold;\n}\n\n.button {\n  color: white;\n  background: var(--color-accent);\n  border-radius: 5px;\n  padding: 8px 20px;\n  transition: var(--transition);\n\n  /* vertically center */\n  display: inline-flex;\n  align-items: center;\n}\n\n.button:hover {\n    box-shadow: 0 0 10px 5px rgba(0, 0, 0, 0.1);\n  }\n\n.button.inverted {\n    background: transparent; \n    color: var(--color-accent); \n    border: 2px solid var(--color-accent);\n  }\n\n/* Markdown styling */\n.content :global(img) {\n    width: 100%;\n    margin: 2rem 0;\n    box-shadow: var(--box-shadow);\n    border-radius: var(--border-radius);\n  }\n.content :global(p) {\n    padding: 0.5rem 0;\n    line-height: 1.5;\n  }\n.content :global(a) {\n    text-decoration: underline;\n  }\n.content :global(h1) {\n    font-size: 2.5rem;\n    font-weight: 600;\n    line-height: 1.2;\n    margin-bottom: 0.5rem;\n  }\n.content :global(h2) {\n    font-size: 2rem;\n    font-weight: 600;\n    margin-bottom: 0.25rem;\n    line-height: 1.2;\n  }\n.content :global(h3) {\n    font-size: 1.5rem;\n    font-weight: 600;\n    line-height: 1.2;\n    margin-top: .5rem;\n  }\n.content :global(ul) {\n    list-style: disc;\n    padding: 0.5rem 0;\n    padding-left: 1.25rem;\n  }\n.content :global(ol) {\n    list-style: decimal;\n    padding: 0.5rem 0;\n    padding-left: 1.25rem;\n  }\n.content :global(blockquote) {\n    padding: 2rem;\n    box-shadow: var(--box-shadow);\n    border-radius: var(--border-radius);\n  }");
			this.h();
		},
		l(nodes) {
			const head_nodes = head_selector('svelte-v5lwg0', document.head);

			link = claim_element(head_nodes, "LINK", {
				rel: true,
				type: true,
				sizes: true,
				href: true
			});

			meta0 = claim_element(head_nodes, "META", { name: true, content: true });
			meta1 = claim_element(head_nodes, "META", { property: true, content: true });
			script0 = claim_element(head_nodes, "SCRIPT", { src: true, "data-website-id": true });
			var script0_nodes = children(script0);
			script0_nodes.forEach(detach);
			script1 = claim_element(head_nodes, "SCRIPT", {});
			var script1_nodes = children(script1);
			t0 = claim_text(script1_nodes, "(function(w,d,e,u,f,l,n){w[f]=w[f]||function(){(w[f].q=w[f].q||[])\n    .push(arguments);},l=d.createElement(e),l.async=1,l.src=u,\n    n=d.getElementsByTagName(e)[0],n.parentNode.insertBefore(l,n);})\n    (window,document,'script','https://assets.mailerlite.com/js/universal.js','ml');\n    ml('account', '714042');\n");
			script1_nodes.forEach(detach);
			style = claim_element(head_nodes, "STYLE", {});
			var style_nodes = children(style);
			t1 = claim_text(style_nodes, "@import url(\"https://unpkg.com/@primo-app/primo@1.3.64/reset.css\");\n@import url('https://fonts.googleapis.com/css2?family=Lexend&display=swap');\n\n#page {\n  --max-width: 740px;\n  /* --color-accent: #FF0000; Beware, we look like the LPC with a red theme on*/ \n  --color-accent: rebeccapurple;\n  font-family: lexend, system-ui, sans-serif;\n  color: var(--color);\n  line-height: 1.6; \n  font-size: 1rem;\n  background: var(--background);\n}\n\n.section-container {\n  max-width: var(--max-width, 1000px);\n  margin: 0 auto;\n  padding: 3rem var(--padding, 1rem); \n}\n\n.heading {\n  font-size: 3rem;\n  line-height: 1;\n  font-weight: 700;\n  margin: 0;\n}\n\na {\n  color: var(--color-accent);\n}\n\n.link {\n  color: var(--color-accent);\n}\n\na:hover {\n  text-decoration: underline;\n  font-weight: bold;\n}\n\n.button {\n  color: white;\n  background: var(--color-accent);\n  border-radius: 5px;\n  padding: 8px 20px;\n  transition: var(--transition);\n\n  /* vertically center */\n  display: inline-flex;\n  align-items: center;\n}\n\n.button:hover {\n    box-shadow: 0 0 10px 5px rgba(0, 0, 0, 0.1);\n  }\n\n.button.inverted {\n    background: transparent; \n    color: var(--color-accent); \n    border: 2px solid var(--color-accent);\n  }\n\n/* Markdown styling */\n.content :global(img) {\n    width: 100%;\n    margin: 2rem 0;\n    box-shadow: var(--box-shadow);\n    border-radius: var(--border-radius);\n  }\n.content :global(p) {\n    padding: 0.5rem 0;\n    line-height: 1.5;\n  }\n.content :global(a) {\n    text-decoration: underline;\n  }\n.content :global(h1) {\n    font-size: 2.5rem;\n    font-weight: 600;\n    line-height: 1.2;\n    margin-bottom: 0.5rem;\n  }\n.content :global(h2) {\n    font-size: 2rem;\n    font-weight: 600;\n    margin-bottom: 0.25rem;\n    line-height: 1.2;\n  }\n.content :global(h3) {\n    font-size: 1.5rem;\n    font-weight: 600;\n    line-height: 1.2;\n    margin-top: .5rem;\n  }\n.content :global(ul) {\n    list-style: disc;\n    padding: 0.5rem 0;\n    padding-left: 1.25rem;\n  }\n.content :global(ol) {\n    list-style: decimal;\n    padding: 0.5rem 0;\n    padding-left: 1.25rem;\n  }\n.content :global(blockquote) {\n    padding: 2rem;\n    box-shadow: var(--box-shadow);\n    border-radius: var(--border-radius);\n  }");
			style_nodes.forEach(detach);
			head_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(link, "rel", "icon");
			attr(link, "type", "image/png");
			attr(link, "sizes", "32x32");
			attr(link, "href", link_href_value = /*favicon*/ ctx[1].url);
			attr(meta0, "name", "viewport");
			attr(meta0, "content", "width=device-width, initial-scale=1.0");
			attr(meta1, "property", "og:image");
			attr(meta1, "content", "https://res.cloudinary.com/dbnijop5c/image/upload/v1712114616/MHC_Logo_temp_nkyfvj.png");
			script0.async = true;
			if (!src_url_equal(script0.src, script0_src_value = "https://eu.umami.is/script.js")) attr(script0, "src", script0_src_value);
			attr(script0, "data-website-id", "85a9067f-bd5a-4cdb-b6ac-e7caecf88793");
		},
		m(target, anchor) {
			append_hydration(document.head, link);
			append_hydration(document.head, meta0);
			append_hydration(document.head, meta1);
			append_hydration(document.head, script0);
			append_hydration(document.head, script1);
			append_hydration(script1, t0);
			append_hydration(document.head, style);
			append_hydration(style, t1);
		},
		p(ctx, [dirty]) {
			if (dirty & /*favicon*/ 2 && link_href_value !== (link_href_value = /*favicon*/ ctx[1].url)) {
				attr(link, "href", link_href_value);
			}

			if (dirty & /*title*/ 1 && title_value !== (title_value = /*title*/ ctx[0])) {
				document.title = title_value;
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			detach(link);
			detach(meta0);
			detach(meta1);
			detach(script0);
			detach(script1);
			detach(style);
		}
	};
}

function instance($$self, $$props, $$invalidate) {
	let { title } = $$props;
	let { favicon } = $$props;

	$$self.$$set = $$props => {
		if ('title' in $$props) $$invalidate(0, title = $$props.title);
		if ('favicon' in $$props) $$invalidate(1, favicon = $$props.favicon);
	};

	return [title, favicon];
}

class Component extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance, create_fragment, safe_not_equal, { title: 0, favicon: 1 });
	}
}

function cubicOut(t) {
    const f = t - 1.0;
    return f * f * f + 1.0;
}

function fade(node, { delay = 0, duration = 400, easing = identity } = {}) {
    const o = +getComputedStyle(node).opacity;
    return {
        delay,
        duration,
        easing,
        css: t => `opacity: ${t * o}`
    };
}
function slide(node, { delay = 0, duration = 400, easing = cubicOut, axis = 'y' } = {}) {
    const style = getComputedStyle(node);
    const opacity = +style.opacity;
    const primary_property = axis === 'y' ? 'height' : 'width';
    const primary_property_value = parseFloat(style[primary_property]);
    const secondary_properties = axis === 'y' ? ['top', 'bottom'] : ['left', 'right'];
    const capitalized_secondary_properties = secondary_properties.map((e) => `${e[0].toUpperCase()}${e.slice(1)}`);
    const padding_start_value = parseFloat(style[`padding${capitalized_secondary_properties[0]}`]);
    const padding_end_value = parseFloat(style[`padding${capitalized_secondary_properties[1]}`]);
    const margin_start_value = parseFloat(style[`margin${capitalized_secondary_properties[0]}`]);
    const margin_end_value = parseFloat(style[`margin${capitalized_secondary_properties[1]}`]);
    const border_width_start_value = parseFloat(style[`border${capitalized_secondary_properties[0]}Width`]);
    const border_width_end_value = parseFloat(style[`border${capitalized_secondary_properties[1]}Width`]);
    return {
        delay,
        duration,
        easing,
        css: t => 'overflow: hidden;' +
            `opacity: ${Math.min(t * 20, 1) * opacity};` +
            `${primary_property}: ${t * primary_property_value}px;` +
            `padding-${secondary_properties[0]}: ${t * padding_start_value}px;` +
            `padding-${secondary_properties[1]}: ${t * padding_end_value}px;` +
            `margin-${secondary_properties[0]}: ${t * margin_start_value}px;` +
            `margin-${secondary_properties[1]}: ${t * margin_end_value}px;` +
            `border-${secondary_properties[0]}-width: ${t * border_width_start_value}px;` +
            `border-${secondary_properties[1]}-width: ${t * border_width_end_value}px;`
    };
}

const matchIconName = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const stringToIcon = (value, validate, allowSimpleName, provider = "") => {
  const colonSeparated = value.split(":");
  if (value.slice(0, 1) === "@") {
    if (colonSeparated.length < 2 || colonSeparated.length > 3) {
      return null;
    }
    provider = colonSeparated.shift().slice(1);
  }
  if (colonSeparated.length > 3 || !colonSeparated.length) {
    return null;
  }
  if (colonSeparated.length > 1) {
    const name2 = colonSeparated.pop();
    const prefix = colonSeparated.pop();
    const result = {
      provider: colonSeparated.length > 0 ? colonSeparated[0] : provider,
      prefix,
      name: name2
    };
    return validate && !validateIconName(result) ? null : result;
  }
  const name = colonSeparated[0];
  const dashSeparated = name.split("-");
  if (dashSeparated.length > 1) {
    const result = {
      provider,
      prefix: dashSeparated.shift(),
      name: dashSeparated.join("-")
    };
    return validate && !validateIconName(result) ? null : result;
  }
  if (allowSimpleName && provider === "") {
    const result = {
      provider,
      prefix: "",
      name
    };
    return validate && !validateIconName(result, allowSimpleName) ? null : result;
  }
  return null;
};
const validateIconName = (icon, allowSimpleName) => {
  if (!icon) {
    return false;
  }
  return !!((icon.provider === "" || icon.provider.match(matchIconName)) && (allowSimpleName && icon.prefix === "" || icon.prefix.match(matchIconName)) && icon.name.match(matchIconName));
};
const defaultIconDimensions = Object.freeze({
  left: 0,
  top: 0,
  width: 16,
  height: 16
});
const defaultIconTransformations = Object.freeze({
  rotate: 0,
  vFlip: false,
  hFlip: false
});
const defaultIconProps = Object.freeze({
  ...defaultIconDimensions,
  ...defaultIconTransformations
});
const defaultExtendedIconProps = Object.freeze({
  ...defaultIconProps,
  body: "",
  hidden: false
});
function mergeIconTransformations(obj1, obj2) {
  const result = {};
  if (!obj1.hFlip !== !obj2.hFlip) {
    result.hFlip = true;
  }
  if (!obj1.vFlip !== !obj2.vFlip) {
    result.vFlip = true;
  }
  const rotate = ((obj1.rotate || 0) + (obj2.rotate || 0)) % 4;
  if (rotate) {
    result.rotate = rotate;
  }
  return result;
}
function mergeIconData(parent, child) {
  const result = mergeIconTransformations(parent, child);
  for (const key in defaultExtendedIconProps) {
    if (key in defaultIconTransformations) {
      if (key in parent && !(key in result)) {
        result[key] = defaultIconTransformations[key];
      }
    } else if (key in child) {
      result[key] = child[key];
    } else if (key in parent) {
      result[key] = parent[key];
    }
  }
  return result;
}
function getIconsTree(data, names) {
  const icons = data.icons;
  const aliases = data.aliases || /* @__PURE__ */ Object.create(null);
  const resolved = /* @__PURE__ */ Object.create(null);
  function resolve(name) {
    if (icons[name]) {
      return resolved[name] = [];
    }
    if (!(name in resolved)) {
      resolved[name] = null;
      const parent = aliases[name] && aliases[name].parent;
      const value = parent && resolve(parent);
      if (value) {
        resolved[name] = [parent].concat(value);
      }
    }
    return resolved[name];
  }
  (names || Object.keys(icons).concat(Object.keys(aliases))).forEach(resolve);
  return resolved;
}
function internalGetIconData(data, name, tree) {
  const icons = data.icons;
  const aliases = data.aliases || /* @__PURE__ */ Object.create(null);
  let currentProps = {};
  function parse(name2) {
    currentProps = mergeIconData(icons[name2] || aliases[name2], currentProps);
  }
  parse(name);
  tree.forEach(parse);
  return mergeIconData(data, currentProps);
}
function parseIconSet(data, callback) {
  const names = [];
  if (typeof data !== "object" || typeof data.icons !== "object") {
    return names;
  }
  if (data.not_found instanceof Array) {
    data.not_found.forEach((name) => {
      callback(name, null);
      names.push(name);
    });
  }
  const tree = getIconsTree(data);
  for (const name in tree) {
    const item = tree[name];
    if (item) {
      callback(name, internalGetIconData(data, name, item));
      names.push(name);
    }
  }
  return names;
}
const optionalPropertyDefaults = {
  provider: "",
  aliases: {},
  not_found: {},
  ...defaultIconDimensions
};
function checkOptionalProps(item, defaults) {
  for (const prop in defaults) {
    if (prop in item && typeof item[prop] !== typeof defaults[prop]) {
      return false;
    }
  }
  return true;
}
function quicklyValidateIconSet(obj) {
  if (typeof obj !== "object" || obj === null) {
    return null;
  }
  const data = obj;
  if (typeof data.prefix !== "string" || !obj.icons || typeof obj.icons !== "object") {
    return null;
  }
  if (!checkOptionalProps(obj, optionalPropertyDefaults)) {
    return null;
  }
  const icons = data.icons;
  for (const name in icons) {
    const icon = icons[name];
    if (!name.match(matchIconName) || typeof icon.body !== "string" || !checkOptionalProps(icon, defaultExtendedIconProps)) {
      return null;
    }
  }
  const aliases = data.aliases || /* @__PURE__ */ Object.create(null);
  for (const name in aliases) {
    const icon = aliases[name];
    const parent = icon.parent;
    if (!name.match(matchIconName) || typeof parent !== "string" || !icons[parent] && !aliases[parent] || !checkOptionalProps(icon, defaultExtendedIconProps)) {
      return null;
    }
  }
  return data;
}
const dataStorage = /* @__PURE__ */ Object.create(null);
function newStorage(provider, prefix) {
  return {
    provider,
    prefix,
    icons: /* @__PURE__ */ Object.create(null),
    missing: /* @__PURE__ */ new Set()
  };
}
function getStorage(provider, prefix) {
  const providerStorage = dataStorage[provider] || (dataStorage[provider] = /* @__PURE__ */ Object.create(null));
  return providerStorage[prefix] || (providerStorage[prefix] = newStorage(provider, prefix));
}
function addIconSet(storage2, data) {
  if (!quicklyValidateIconSet(data)) {
    return [];
  }
  return parseIconSet(data, (name, icon) => {
    if (icon) {
      storage2.icons[name] = icon;
    } else {
      storage2.missing.add(name);
    }
  });
}
function addIconToStorage(storage2, name, icon) {
  try {
    if (typeof icon.body === "string") {
      storage2.icons[name] = {...icon};
      return true;
    }
  } catch (err) {
  }
  return false;
}
let simpleNames = false;
function allowSimpleNames(allow) {
  if (typeof allow === "boolean") {
    simpleNames = allow;
  }
  return simpleNames;
}
function getIconData(name) {
  const icon = typeof name === "string" ? stringToIcon(name, true, simpleNames) : name;
  if (icon) {
    const storage2 = getStorage(icon.provider, icon.prefix);
    const iconName = icon.name;
    return storage2.icons[iconName] || (storage2.missing.has(iconName) ? null : void 0);
  }
}
function addIcon(name, data) {
  const icon = stringToIcon(name, true, simpleNames);
  if (!icon) {
    return false;
  }
  const storage2 = getStorage(icon.provider, icon.prefix);
  return addIconToStorage(storage2, icon.name, data);
}
function addCollection(data, provider) {
  if (typeof data !== "object") {
    return false;
  }
  if (typeof provider !== "string") {
    provider = data.provider || "";
  }
  if (simpleNames && !provider && !data.prefix) {
    let added = false;
    if (quicklyValidateIconSet(data)) {
      data.prefix = "";
      parseIconSet(data, (name, icon) => {
        if (icon && addIcon(name, icon)) {
          added = true;
        }
      });
    }
    return added;
  }
  const prefix = data.prefix;
  if (!validateIconName({
    provider,
    prefix,
    name: "a"
  })) {
    return false;
  }
  const storage2 = getStorage(provider, prefix);
  return !!addIconSet(storage2, data);
}
const defaultIconSizeCustomisations = Object.freeze({
  width: null,
  height: null
});
const defaultIconCustomisations = Object.freeze({
  ...defaultIconSizeCustomisations,
  ...defaultIconTransformations
});
const unitsSplit = /(-?[0-9.]*[0-9]+[0-9.]*)/g;
const unitsTest = /^-?[0-9.]*[0-9]+[0-9.]*$/g;
function calculateSize(size, ratio, precision) {
  if (ratio === 1) {
    return size;
  }
  precision = precision || 100;
  if (typeof size === "number") {
    return Math.ceil(size * ratio * precision) / precision;
  }
  if (typeof size !== "string") {
    return size;
  }
  const oldParts = size.split(unitsSplit);
  if (oldParts === null || !oldParts.length) {
    return size;
  }
  const newParts = [];
  let code = oldParts.shift();
  let isNumber = unitsTest.test(code);
  while (true) {
    if (isNumber) {
      const num = parseFloat(code);
      if (isNaN(num)) {
        newParts.push(code);
      } else {
        newParts.push(Math.ceil(num * ratio * precision) / precision);
      }
    } else {
      newParts.push(code);
    }
    code = oldParts.shift();
    if (code === void 0) {
      return newParts.join("");
    }
    isNumber = !isNumber;
  }
}
function splitSVGDefs(content, tag = "defs") {
  let defs = "";
  const index = content.indexOf("<" + tag);
  while (index >= 0) {
    const start = content.indexOf(">", index);
    const end = content.indexOf("</" + tag);
    if (start === -1 || end === -1) {
      break;
    }
    const endEnd = content.indexOf(">", end);
    if (endEnd === -1) {
      break;
    }
    defs += content.slice(start + 1, end).trim();
    content = content.slice(0, index).trim() + content.slice(endEnd + 1);
  }
  return {
    defs,
    content
  };
}
function mergeDefsAndContent(defs, content) {
  return defs ? "<defs>" + defs + "</defs>" + content : content;
}
function wrapSVGContent(body, start, end) {
  const split = splitSVGDefs(body);
  return mergeDefsAndContent(split.defs, start + split.content + end);
}
const isUnsetKeyword = (value) => value === "unset" || value === "undefined" || value === "none";
function iconToSVG(icon, customisations) {
  const fullIcon = {
    ...defaultIconProps,
    ...icon
  };
  const fullCustomisations = {
    ...defaultIconCustomisations,
    ...customisations
  };
  const box = {
    left: fullIcon.left,
    top: fullIcon.top,
    width: fullIcon.width,
    height: fullIcon.height
  };
  let body = fullIcon.body;
  [fullIcon, fullCustomisations].forEach((props) => {
    const transformations = [];
    const hFlip = props.hFlip;
    const vFlip = props.vFlip;
    let rotation = props.rotate;
    if (hFlip) {
      if (vFlip) {
        rotation += 2;
      } else {
        transformations.push("translate(" + (box.width + box.left).toString() + " " + (0 - box.top).toString() + ")");
        transformations.push("scale(-1 1)");
        box.top = box.left = 0;
      }
    } else if (vFlip) {
      transformations.push("translate(" + (0 - box.left).toString() + " " + (box.height + box.top).toString() + ")");
      transformations.push("scale(1 -1)");
      box.top = box.left = 0;
    }
    let tempValue;
    if (rotation < 0) {
      rotation -= Math.floor(rotation / 4) * 4;
    }
    rotation = rotation % 4;
    switch (rotation) {
      case 1:
        tempValue = box.height / 2 + box.top;
        transformations.unshift("rotate(90 " + tempValue.toString() + " " + tempValue.toString() + ")");
        break;
      case 2:
        transformations.unshift("rotate(180 " + (box.width / 2 + box.left).toString() + " " + (box.height / 2 + box.top).toString() + ")");
        break;
      case 3:
        tempValue = box.width / 2 + box.left;
        transformations.unshift("rotate(-90 " + tempValue.toString() + " " + tempValue.toString() + ")");
        break;
    }
    if (rotation % 2 === 1) {
      if (box.left !== box.top) {
        tempValue = box.left;
        box.left = box.top;
        box.top = tempValue;
      }
      if (box.width !== box.height) {
        tempValue = box.width;
        box.width = box.height;
        box.height = tempValue;
      }
    }
    if (transformations.length) {
      body = wrapSVGContent(body, '<g transform="' + transformations.join(" ") + '">', "</g>");
    }
  });
  const customisationsWidth = fullCustomisations.width;
  const customisationsHeight = fullCustomisations.height;
  const boxWidth = box.width;
  const boxHeight = box.height;
  let width;
  let height;
  if (customisationsWidth === null) {
    height = customisationsHeight === null ? "1em" : customisationsHeight === "auto" ? boxHeight : customisationsHeight;
    width = calculateSize(height, boxWidth / boxHeight);
  } else {
    width = customisationsWidth === "auto" ? boxWidth : customisationsWidth;
    height = customisationsHeight === null ? calculateSize(width, boxHeight / boxWidth) : customisationsHeight === "auto" ? boxHeight : customisationsHeight;
  }
  const attributes = {};
  const setAttr = (prop, value) => {
    if (!isUnsetKeyword(value)) {
      attributes[prop] = value.toString();
    }
  };
  setAttr("width", width);
  setAttr("height", height);
  const viewBox = [box.left, box.top, boxWidth, boxHeight];
  attributes.viewBox = viewBox.join(" ");
  return {
    attributes,
    viewBox,
    body
  };
}
const regex = /\sid="(\S+)"/g;
const randomPrefix = "IconifyId" + Date.now().toString(16) + (Math.random() * 16777216 | 0).toString(16);
let counter = 0;
function replaceIDs(body, prefix = randomPrefix) {
  const ids = [];
  let match;
  while (match = regex.exec(body)) {
    ids.push(match[1]);
  }
  if (!ids.length) {
    return body;
  }
  const suffix = "suffix" + (Math.random() * 16777216 | Date.now()).toString(16);
  ids.forEach((id) => {
    const newID = typeof prefix === "function" ? prefix(id) : prefix + (counter++).toString();
    const escapedID = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    body = body.replace(new RegExp('([#;"])(' + escapedID + ')([")]|\\.[a-z])', "g"), "$1" + newID + suffix + "$3");
  });
  body = body.replace(new RegExp(suffix, "g"), "");
  return body;
}
const storage = /* @__PURE__ */ Object.create(null);
function setAPIModule(provider, item) {
  storage[provider] = item;
}
function getAPIModule(provider) {
  return storage[provider] || storage[""];
}
function createAPIConfig(source) {
  let resources;
  if (typeof source.resources === "string") {
    resources = [source.resources];
  } else {
    resources = source.resources;
    if (!(resources instanceof Array) || !resources.length) {
      return null;
    }
  }
  const result = {
    resources,
    path: source.path || "/",
    maxURL: source.maxURL || 500,
    rotate: source.rotate || 750,
    timeout: source.timeout || 5e3,
    random: source.random === true,
    index: source.index || 0,
    dataAfterTimeout: source.dataAfterTimeout !== false
  };
  return result;
}
const configStorage = /* @__PURE__ */ Object.create(null);
const fallBackAPISources = [
  "https://api.simplesvg.com",
  "https://api.unisvg.com"
];
const fallBackAPI = [];
while (fallBackAPISources.length > 0) {
  if (fallBackAPISources.length === 1) {
    fallBackAPI.push(fallBackAPISources.shift());
  } else {
    if (Math.random() > 0.5) {
      fallBackAPI.push(fallBackAPISources.shift());
    } else {
      fallBackAPI.push(fallBackAPISources.pop());
    }
  }
}
configStorage[""] = createAPIConfig({
  resources: ["https://api.iconify.design"].concat(fallBackAPI)
});
function addAPIProvider(provider, customConfig) {
  const config = createAPIConfig(customConfig);
  if (config === null) {
    return false;
  }
  configStorage[provider] = config;
  return true;
}
function getAPIConfig(provider) {
  return configStorage[provider];
}
const detectFetch = () => {
  let callback;
  try {
    callback = fetch;
    if (typeof callback === "function") {
      return callback;
    }
  } catch (err) {
  }
};
let fetchModule = detectFetch();
function calculateMaxLength(provider, prefix) {
  const config = getAPIConfig(provider);
  if (!config) {
    return 0;
  }
  let result;
  if (!config.maxURL) {
    result = 0;
  } else {
    let maxHostLength = 0;
    config.resources.forEach((item) => {
      const host = item;
      maxHostLength = Math.max(maxHostLength, host.length);
    });
    const url = prefix + ".json?icons=";
    result = config.maxURL - maxHostLength - config.path.length - url.length;
  }
  return result;
}
function shouldAbort(status) {
  return status === 404;
}
const prepare = (provider, prefix, icons) => {
  const results = [];
  const maxLength = calculateMaxLength(provider, prefix);
  const type = "icons";
  let item = {
    type,
    provider,
    prefix,
    icons: []
  };
  let length = 0;
  icons.forEach((name, index) => {
    length += name.length + 1;
    if (length >= maxLength && index > 0) {
      results.push(item);
      item = {
        type,
        provider,
        prefix,
        icons: []
      };
      length = name.length;
    }
    item.icons.push(name);
  });
  results.push(item);
  return results;
};
function getPath(provider) {
  if (typeof provider === "string") {
    const config = getAPIConfig(provider);
    if (config) {
      return config.path;
    }
  }
  return "/";
}
const send = (host, params, callback) => {
  if (!fetchModule) {
    callback("abort", 424);
    return;
  }
  let path = getPath(params.provider);
  switch (params.type) {
    case "icons": {
      const prefix = params.prefix;
      const icons = params.icons;
      const iconsList = icons.join(",");
      const urlParams = new URLSearchParams({
        icons: iconsList
      });
      path += prefix + ".json?" + urlParams.toString();
      break;
    }
    case "custom": {
      const uri = params.uri;
      path += uri.slice(0, 1) === "/" ? uri.slice(1) : uri;
      break;
    }
    default:
      callback("abort", 400);
      return;
  }
  let defaultError = 503;
  fetchModule(host + path).then((response) => {
    const status = response.status;
    if (status !== 200) {
      setTimeout(() => {
        callback(shouldAbort(status) ? "abort" : "next", status);
      });
      return;
    }
    defaultError = 501;
    return response.json();
  }).then((data) => {
    if (typeof data !== "object" || data === null) {
      setTimeout(() => {
        if (data === 404) {
          callback("abort", data);
        } else {
          callback("next", defaultError);
        }
      });
      return;
    }
    setTimeout(() => {
      callback("success", data);
    });
  }).catch(() => {
    callback("next", defaultError);
  });
};
const fetchAPIModule = {
  prepare,
  send
};
function sortIcons(icons) {
  const result = {
    loaded: [],
    missing: [],
    pending: []
  };
  const storage2 = /* @__PURE__ */ Object.create(null);
  icons.sort((a, b) => {
    if (a.provider !== b.provider) {
      return a.provider.localeCompare(b.provider);
    }
    if (a.prefix !== b.prefix) {
      return a.prefix.localeCompare(b.prefix);
    }
    return a.name.localeCompare(b.name);
  });
  let lastIcon = {
    provider: "",
    prefix: "",
    name: ""
  };
  icons.forEach((icon) => {
    if (lastIcon.name === icon.name && lastIcon.prefix === icon.prefix && lastIcon.provider === icon.provider) {
      return;
    }
    lastIcon = icon;
    const provider = icon.provider;
    const prefix = icon.prefix;
    const name = icon.name;
    const providerStorage = storage2[provider] || (storage2[provider] = /* @__PURE__ */ Object.create(null));
    const localStorage = providerStorage[prefix] || (providerStorage[prefix] = getStorage(provider, prefix));
    let list;
    if (name in localStorage.icons) {
      list = result.loaded;
    } else if (prefix === "" || localStorage.missing.has(name)) {
      list = result.missing;
    } else {
      list = result.pending;
    }
    const item = {
      provider,
      prefix,
      name
    };
    list.push(item);
  });
  return result;
}
function removeCallback(storages, id) {
  storages.forEach((storage2) => {
    const items = storage2.loaderCallbacks;
    if (items) {
      storage2.loaderCallbacks = items.filter((row) => row.id !== id);
    }
  });
}
function updateCallbacks(storage2) {
  if (!storage2.pendingCallbacksFlag) {
    storage2.pendingCallbacksFlag = true;
    setTimeout(() => {
      storage2.pendingCallbacksFlag = false;
      const items = storage2.loaderCallbacks ? storage2.loaderCallbacks.slice(0) : [];
      if (!items.length) {
        return;
      }
      let hasPending = false;
      const provider = storage2.provider;
      const prefix = storage2.prefix;
      items.forEach((item) => {
        const icons = item.icons;
        const oldLength = icons.pending.length;
        icons.pending = icons.pending.filter((icon) => {
          if (icon.prefix !== prefix) {
            return true;
          }
          const name = icon.name;
          if (storage2.icons[name]) {
            icons.loaded.push({
              provider,
              prefix,
              name
            });
          } else if (storage2.missing.has(name)) {
            icons.missing.push({
              provider,
              prefix,
              name
            });
          } else {
            hasPending = true;
            return true;
          }
          return false;
        });
        if (icons.pending.length !== oldLength) {
          if (!hasPending) {
            removeCallback([storage2], item.id);
          }
          item.callback(icons.loaded.slice(0), icons.missing.slice(0), icons.pending.slice(0), item.abort);
        }
      });
    });
  }
}
let idCounter = 0;
function storeCallback(callback, icons, pendingSources) {
  const id = idCounter++;
  const abort = removeCallback.bind(null, pendingSources, id);
  if (!icons.pending.length) {
    return abort;
  }
  const item = {
    id,
    icons,
    callback,
    abort
  };
  pendingSources.forEach((storage2) => {
    (storage2.loaderCallbacks || (storage2.loaderCallbacks = [])).push(item);
  });
  return abort;
}
function listToIcons(list, validate = true, simpleNames2 = false) {
  const result = [];
  list.forEach((item) => {
    const icon = typeof item === "string" ? stringToIcon(item, validate, simpleNames2) : item;
    if (icon) {
      result.push(icon);
    }
  });
  return result;
}
var defaultConfig = {
  resources: [],
  index: 0,
  timeout: 2e3,
  rotate: 750,
  random: false,
  dataAfterTimeout: false
};
function sendQuery(config, payload, query, done) {
  const resourcesCount = config.resources.length;
  const startIndex = config.random ? Math.floor(Math.random() * resourcesCount) : config.index;
  let resources;
  if (config.random) {
    let list = config.resources.slice(0);
    resources = [];
    while (list.length > 1) {
      const nextIndex = Math.floor(Math.random() * list.length);
      resources.push(list[nextIndex]);
      list = list.slice(0, nextIndex).concat(list.slice(nextIndex + 1));
    }
    resources = resources.concat(list);
  } else {
    resources = config.resources.slice(startIndex).concat(config.resources.slice(0, startIndex));
  }
  const startTime = Date.now();
  let status = "pending";
  let queriesSent = 0;
  let lastError;
  let timer = null;
  let queue = [];
  let doneCallbacks = [];
  if (typeof done === "function") {
    doneCallbacks.push(done);
  }
  function resetTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function abort() {
    if (status === "pending") {
      status = "aborted";
    }
    resetTimer();
    queue.forEach((item) => {
      if (item.status === "pending") {
        item.status = "aborted";
      }
    });
    queue = [];
  }
  function subscribe(callback, overwrite) {
    if (overwrite) {
      doneCallbacks = [];
    }
    if (typeof callback === "function") {
      doneCallbacks.push(callback);
    }
  }
  function getQueryStatus() {
    return {
      startTime,
      payload,
      status,
      queriesSent,
      queriesPending: queue.length,
      subscribe,
      abort
    };
  }
  function failQuery() {
    status = "failed";
    doneCallbacks.forEach((callback) => {
      callback(void 0, lastError);
    });
  }
  function clearQueue() {
    queue.forEach((item) => {
      if (item.status === "pending") {
        item.status = "aborted";
      }
    });
    queue = [];
  }
  function moduleResponse(item, response, data) {
    const isError = response !== "success";
    queue = queue.filter((queued) => queued !== item);
    switch (status) {
      case "pending":
        break;
      case "failed":
        if (isError || !config.dataAfterTimeout) {
          return;
        }
        break;
      default:
        return;
    }
    if (response === "abort") {
      lastError = data;
      failQuery();
      return;
    }
    if (isError) {
      lastError = data;
      if (!queue.length) {
        if (!resources.length) {
          failQuery();
        } else {
          execNext();
        }
      }
      return;
    }
    resetTimer();
    clearQueue();
    if (!config.random) {
      const index = config.resources.indexOf(item.resource);
      if (index !== -1 && index !== config.index) {
        config.index = index;
      }
    }
    status = "completed";
    doneCallbacks.forEach((callback) => {
      callback(data);
    });
  }
  function execNext() {
    if (status !== "pending") {
      return;
    }
    resetTimer();
    const resource = resources.shift();
    if (resource === void 0) {
      if (queue.length) {
        timer = setTimeout(() => {
          resetTimer();
          if (status === "pending") {
            clearQueue();
            failQuery();
          }
        }, config.timeout);
        return;
      }
      failQuery();
      return;
    }
    const item = {
      status: "pending",
      resource,
      callback: (status2, data) => {
        moduleResponse(item, status2, data);
      }
    };
    queue.push(item);
    queriesSent++;
    timer = setTimeout(execNext, config.rotate);
    query(resource, payload, item.callback);
  }
  setTimeout(execNext);
  return getQueryStatus;
}
function initRedundancy(cfg) {
  const config = {
    ...defaultConfig,
    ...cfg
  };
  let queries = [];
  function cleanup() {
    queries = queries.filter((item) => item().status === "pending");
  }
  function query(payload, queryCallback, doneCallback) {
    const query2 = sendQuery(config, payload, queryCallback, (data, error) => {
      cleanup();
      if (doneCallback) {
        doneCallback(data, error);
      }
    });
    queries.push(query2);
    return query2;
  }
  function find(callback) {
    return queries.find((value) => {
      return callback(value);
    }) || null;
  }
  const instance = {
    query,
    find,
    setIndex: (index) => {
      config.index = index;
    },
    getIndex: () => config.index,
    cleanup
  };
  return instance;
}
function emptyCallback$1() {
}
const redundancyCache = /* @__PURE__ */ Object.create(null);
function getRedundancyCache(provider) {
  if (!redundancyCache[provider]) {
    const config = getAPIConfig(provider);
    if (!config) {
      return;
    }
    const redundancy = initRedundancy(config);
    const cachedReundancy = {
      config,
      redundancy
    };
    redundancyCache[provider] = cachedReundancy;
  }
  return redundancyCache[provider];
}
function sendAPIQuery(target, query, callback) {
  let redundancy;
  let send2;
  if (typeof target === "string") {
    const api = getAPIModule(target);
    if (!api) {
      callback(void 0, 424);
      return emptyCallback$1;
    }
    send2 = api.send;
    const cached = getRedundancyCache(target);
    if (cached) {
      redundancy = cached.redundancy;
    }
  } else {
    const config = createAPIConfig(target);
    if (config) {
      redundancy = initRedundancy(config);
      const moduleKey = target.resources ? target.resources[0] : "";
      const api = getAPIModule(moduleKey);
      if (api) {
        send2 = api.send;
      }
    }
  }
  if (!redundancy || !send2) {
    callback(void 0, 424);
    return emptyCallback$1;
  }
  return redundancy.query(query, send2, callback)().abort;
}
const browserCacheVersion = "iconify2";
const browserCachePrefix = "iconify";
const browserCacheCountKey = browserCachePrefix + "-count";
const browserCacheVersionKey = browserCachePrefix + "-version";
const browserStorageHour = 36e5;
const browserStorageCacheExpiration = 168;
const browserStorageLimit = 50;
function getStoredItem(func, key) {
  try {
    return func.getItem(key);
  } catch (err) {
  }
}
function setStoredItem(func, key, value) {
  try {
    func.setItem(key, value);
    return true;
  } catch (err) {
  }
}
function removeStoredItem(func, key) {
  try {
    func.removeItem(key);
  } catch (err) {
  }
}
function setBrowserStorageItemsCount(storage2, value) {
  return setStoredItem(storage2, browserCacheCountKey, value.toString());
}
function getBrowserStorageItemsCount(storage2) {
  return parseInt(getStoredItem(storage2, browserCacheCountKey)) || 0;
}
const browserStorageConfig = {
  local: true,
  session: true
};
const browserStorageEmptyItems = {
  local: /* @__PURE__ */ new Set(),
  session: /* @__PURE__ */ new Set()
};
let browserStorageStatus = false;
function setBrowserStorageStatus(status) {
  browserStorageStatus = status;
}
let _window = typeof window === "undefined" ? {} : window;
function getBrowserStorage(key) {
  const attr = key + "Storage";
  try {
    if (_window && _window[attr] && typeof _window[attr].length === "number") {
      return _window[attr];
    }
  } catch (err) {
  }
  browserStorageConfig[key] = false;
}
function iterateBrowserStorage(key, callback) {
  const func = getBrowserStorage(key);
  if (!func) {
    return;
  }
  const version = getStoredItem(func, browserCacheVersionKey);
  if (version !== browserCacheVersion) {
    if (version) {
      const total2 = getBrowserStorageItemsCount(func);
      for (let i = 0; i < total2; i++) {
        removeStoredItem(func, browserCachePrefix + i.toString());
      }
    }
    setStoredItem(func, browserCacheVersionKey, browserCacheVersion);
    setBrowserStorageItemsCount(func, 0);
    return;
  }
  const minTime = Math.floor(Date.now() / browserStorageHour) - browserStorageCacheExpiration;
  const parseItem = (index) => {
    const name = browserCachePrefix + index.toString();
    const item = getStoredItem(func, name);
    if (typeof item !== "string") {
      return;
    }
    try {
      const data = JSON.parse(item);
      if (typeof data === "object" && typeof data.cached === "number" && data.cached > minTime && typeof data.provider === "string" && typeof data.data === "object" && typeof data.data.prefix === "string" && callback(data, index)) {
        return true;
      }
    } catch (err) {
    }
    removeStoredItem(func, name);
  };
  let total = getBrowserStorageItemsCount(func);
  for (let i = total - 1; i >= 0; i--) {
    if (!parseItem(i)) {
      if (i === total - 1) {
        total--;
        setBrowserStorageItemsCount(func, total);
      } else {
        browserStorageEmptyItems[key].add(i);
      }
    }
  }
}
function initBrowserStorage() {
  if (browserStorageStatus) {
    return;
  }
  setBrowserStorageStatus(true);
  for (const key in browserStorageConfig) {
    iterateBrowserStorage(key, (item) => {
      const iconSet = item.data;
      const provider = item.provider;
      const prefix = iconSet.prefix;
      const storage2 = getStorage(provider, prefix);
      if (!addIconSet(storage2, iconSet).length) {
        return false;
      }
      const lastModified = iconSet.lastModified || -1;
      storage2.lastModifiedCached = storage2.lastModifiedCached ? Math.min(storage2.lastModifiedCached, lastModified) : lastModified;
      return true;
    });
  }
}
function updateLastModified(storage2, lastModified) {
  const lastValue = storage2.lastModifiedCached;
  if (lastValue && lastValue >= lastModified) {
    return lastValue === lastModified;
  }
  storage2.lastModifiedCached = lastModified;
  if (lastValue) {
    for (const key in browserStorageConfig) {
      iterateBrowserStorage(key, (item) => {
        const iconSet = item.data;
        return item.provider !== storage2.provider || iconSet.prefix !== storage2.prefix || iconSet.lastModified === lastModified;
      });
    }
  }
  return true;
}
function storeInBrowserStorage(storage2, data) {
  if (!browserStorageStatus) {
    initBrowserStorage();
  }
  function store(key) {
    let func;
    if (!browserStorageConfig[key] || !(func = getBrowserStorage(key))) {
      return;
    }
    const set = browserStorageEmptyItems[key];
    let index;
    if (set.size) {
      set.delete(index = Array.from(set).shift());
    } else {
      index = getBrowserStorageItemsCount(func);
      if (index >= browserStorageLimit || !setBrowserStorageItemsCount(func, index + 1)) {
        return;
      }
    }
    const item = {
      cached: Math.floor(Date.now() / browserStorageHour),
      provider: storage2.provider,
      data
    };
    return setStoredItem(func, browserCachePrefix + index.toString(), JSON.stringify(item));
  }
  if (data.lastModified && !updateLastModified(storage2, data.lastModified)) {
    return;
  }
  if (!Object.keys(data.icons).length) {
    return;
  }
  if (data.not_found) {
    data = Object.assign({}, data);
    delete data.not_found;
  }
  if (!store("local")) {
    store("session");
  }
}
function emptyCallback() {
}
function loadedNewIcons(storage2) {
  if (!storage2.iconsLoaderFlag) {
    storage2.iconsLoaderFlag = true;
    setTimeout(() => {
      storage2.iconsLoaderFlag = false;
      updateCallbacks(storage2);
    });
  }
}
function loadNewIcons(storage2, icons) {
  if (!storage2.iconsToLoad) {
    storage2.iconsToLoad = icons;
  } else {
    storage2.iconsToLoad = storage2.iconsToLoad.concat(icons).sort();
  }
  if (!storage2.iconsQueueFlag) {
    storage2.iconsQueueFlag = true;
    setTimeout(() => {
      storage2.iconsQueueFlag = false;
      const {provider, prefix} = storage2;
      const icons2 = storage2.iconsToLoad;
      delete storage2.iconsToLoad;
      let api;
      if (!icons2 || !(api = getAPIModule(provider))) {
        return;
      }
      const params = api.prepare(provider, prefix, icons2);
      params.forEach((item) => {
        sendAPIQuery(provider, item, (data) => {
          if (typeof data !== "object") {
            item.icons.forEach((name) => {
              storage2.missing.add(name);
            });
          } else {
            try {
              const parsed = addIconSet(storage2, data);
              if (!parsed.length) {
                return;
              }
              const pending = storage2.pendingIcons;
              if (pending) {
                parsed.forEach((name) => {
                  pending.delete(name);
                });
              }
              storeInBrowserStorage(storage2, data);
            } catch (err) {
              console.error(err);
            }
          }
          loadedNewIcons(storage2);
        });
      });
    });
  }
}
const loadIcons = (icons, callback) => {
  const cleanedIcons = listToIcons(icons, true, allowSimpleNames());
  const sortedIcons = sortIcons(cleanedIcons);
  if (!sortedIcons.pending.length) {
    let callCallback = true;
    if (callback) {
      setTimeout(() => {
        if (callCallback) {
          callback(sortedIcons.loaded, sortedIcons.missing, sortedIcons.pending, emptyCallback);
        }
      });
    }
    return () => {
      callCallback = false;
    };
  }
  const newIcons = /* @__PURE__ */ Object.create(null);
  const sources = [];
  let lastProvider, lastPrefix;
  sortedIcons.pending.forEach((icon) => {
    const {provider, prefix} = icon;
    if (prefix === lastPrefix && provider === lastProvider) {
      return;
    }
    lastProvider = provider;
    lastPrefix = prefix;
    sources.push(getStorage(provider, prefix));
    const providerNewIcons = newIcons[provider] || (newIcons[provider] = /* @__PURE__ */ Object.create(null));
    if (!providerNewIcons[prefix]) {
      providerNewIcons[prefix] = [];
    }
  });
  sortedIcons.pending.forEach((icon) => {
    const {provider, prefix, name} = icon;
    const storage2 = getStorage(provider, prefix);
    const pendingQueue = storage2.pendingIcons || (storage2.pendingIcons = /* @__PURE__ */ new Set());
    if (!pendingQueue.has(name)) {
      pendingQueue.add(name);
      newIcons[provider][prefix].push(name);
    }
  });
  sources.forEach((storage2) => {
    const {provider, prefix} = storage2;
    if (newIcons[provider][prefix].length) {
      loadNewIcons(storage2, newIcons[provider][prefix]);
    }
  });
  return callback ? storeCallback(callback, sortedIcons, sources) : emptyCallback;
};
function mergeCustomisations(defaults, item) {
  const result = {
    ...defaults
  };
  for (const key in item) {
    const value = item[key];
    const valueType = typeof value;
    if (key in defaultIconSizeCustomisations) {
      if (value === null || value && (valueType === "string" || valueType === "number")) {
        result[key] = value;
      }
    } else if (valueType === typeof result[key]) {
      result[key] = key === "rotate" ? value % 4 : value;
    }
  }
  return result;
}
const separator = /[\s,]+/;
function flipFromString(custom, flip) {
  flip.split(separator).forEach((str) => {
    const value = str.trim();
    switch (value) {
      case "horizontal":
        custom.hFlip = true;
        break;
      case "vertical":
        custom.vFlip = true;
        break;
    }
  });
}
function rotateFromString(value, defaultValue = 0) {
  const units = value.replace(/^-?[0-9.]*/, "");
  function cleanup(value2) {
    while (value2 < 0) {
      value2 += 4;
    }
    return value2 % 4;
  }
  if (units === "") {
    const num = parseInt(value);
    return isNaN(num) ? 0 : cleanup(num);
  } else if (units !== value) {
    let split = 0;
    switch (units) {
      case "%":
        split = 25;
        break;
      case "deg":
        split = 90;
    }
    if (split) {
      let num = parseFloat(value.slice(0, value.length - units.length));
      if (isNaN(num)) {
        return 0;
      }
      num = num / split;
      return num % 1 === 0 ? cleanup(num) : 0;
    }
  }
  return defaultValue;
}
function iconToHTML(body, attributes) {
  let renderAttribsHTML = body.indexOf("xlink:") === -1 ? "" : ' xmlns:xlink="http://www.w3.org/1999/xlink"';
  for (const attr in attributes) {
    renderAttribsHTML += " " + attr + '="' + attributes[attr] + '"';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg"' + renderAttribsHTML + ">" + body + "</svg>";
}
function encodeSVGforURL(svg) {
  return svg.replace(/"/g, "'").replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\s+/g, " ");
}
function svgToData(svg) {
  return "data:image/svg+xml," + encodeSVGforURL(svg);
}
function svgToURL(svg) {
  return 'url("' + svgToData(svg) + '")';
}
const defaultExtendedIconCustomisations = {
  ...defaultIconCustomisations,
  inline: false
};
const svgDefaults = {
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  "aria-hidden": true,
  role: "img"
};
const commonProps = {
  display: "inline-block"
};
const monotoneProps = {
  "background-color": "currentColor"
};
const coloredProps = {
  "background-color": "transparent"
};
const propsToAdd = {
  image: "var(--svg)",
  repeat: "no-repeat",
  size: "100% 100%"
};
const propsToAddTo = {
  "-webkit-mask": monotoneProps,
  mask: monotoneProps,
  background: coloredProps
};
for (const prefix in propsToAddTo) {
  const list = propsToAddTo[prefix];
  for (const prop in propsToAdd) {
    list[prefix + "-" + prop] = propsToAdd[prop];
  }
}
function fixSize(value) {
  return value + (value.match(/^[-0-9.]+$/) ? "px" : "");
}
function render(icon, props) {
  const customisations = mergeCustomisations(defaultExtendedIconCustomisations, props);
  const mode = props.mode || "svg";
  const componentProps = mode === "svg" ? {...svgDefaults} : {};
  if (icon.body.indexOf("xlink:") === -1) {
    delete componentProps["xmlns:xlink"];
  }
  let style = typeof props.style === "string" ? props.style : "";
  for (let key in props) {
    const value = props[key];
    if (value === void 0) {
      continue;
    }
    switch (key) {
      case "icon":
      case "style":
      case "onLoad":
      case "mode":
        break;
      case "inline":
      case "hFlip":
      case "vFlip":
        customisations[key] = value === true || value === "true" || value === 1;
        break;
      case "flip":
        if (typeof value === "string") {
          flipFromString(customisations, value);
        }
        break;
      case "color":
        style = style + (style.length > 0 && style.trim().slice(-1) !== ";" ? ";" : "") + "color: " + value + "; ";
        break;
      case "rotate":
        if (typeof value === "string") {
          customisations[key] = rotateFromString(value);
        } else if (typeof value === "number") {
          customisations[key] = value;
        }
        break;
      case "ariaHidden":
      case "aria-hidden":
        if (value !== true && value !== "true") {
          delete componentProps["aria-hidden"];
        }
        break;
      default:
        if (key.slice(0, 3) === "on:") {
          break;
        }
        if (defaultExtendedIconCustomisations[key] === void 0) {
          componentProps[key] = value;
        }
    }
  }
  const item = iconToSVG(icon, customisations);
  const renderAttribs = item.attributes;
  if (customisations.inline) {
    style = "vertical-align: -0.125em; " + style;
  }
  if (mode === "svg") {
    Object.assign(componentProps, renderAttribs);
    if (style !== "") {
      componentProps.style = style;
    }
    let localCounter = 0;
    let id = props.id;
    if (typeof id === "string") {
      id = id.replace(/-/g, "_");
    }
    return {
      svg: true,
      attributes: componentProps,
      body: replaceIDs(item.body, id ? () => id + "ID" + localCounter++ : "iconifySvelte")
    };
  }
  const {body, width, height} = icon;
  const useMask = mode === "mask" || (mode === "bg" ? false : body.indexOf("currentColor") !== -1);
  const html = iconToHTML(body, {
    ...renderAttribs,
    width: width + "",
    height: height + ""
  });
  const url = svgToURL(html);
  const styles = {
    "--svg": url
  };
  const size = (prop) => {
    const value = renderAttribs[prop];
    if (value) {
      styles[prop] = fixSize(value);
    }
  };
  size("width");
  size("height");
  Object.assign(styles, commonProps, useMask ? monotoneProps : coloredProps);
  let customStyle = "";
  for (const key in styles) {
    customStyle += key + ": " + styles[key] + ";";
  }
  componentProps.style = customStyle + style;
  return {
    svg: false,
    attributes: componentProps
  };
}
allowSimpleNames(true);
setAPIModule("", fetchAPIModule);
if (typeof document !== "undefined" && typeof window !== "undefined") {
  initBrowserStorage();
  const _window2 = window;
  if (_window2.IconifyPreload !== void 0) {
    const preload = _window2.IconifyPreload;
    const err = "Invalid IconifyPreload syntax.";
    if (typeof preload === "object" && preload !== null) {
      (preload instanceof Array ? preload : [preload]).forEach((item) => {
        try {
          if (typeof item !== "object" || item === null || item instanceof Array || typeof item.icons !== "object" || typeof item.prefix !== "string" || !addCollection(item)) {
            console.error(err);
          }
        } catch (e) {
          console.error(err);
        }
      });
    }
  }
  if (_window2.IconifyProviders !== void 0) {
    const providers = _window2.IconifyProviders;
    if (typeof providers === "object" && providers !== null) {
      for (let key in providers) {
        const err = "IconifyProviders[" + key + "] is invalid.";
        try {
          const value = providers[key];
          if (typeof value !== "object" || !value || value.resources === void 0) {
            continue;
          }
          if (!addAPIProvider(key, value)) {
            console.error(err);
          }
        } catch (e) {
          console.error(err);
        }
      }
    }
  }
}
function checkIconState(icon, state, mounted, callback, onload) {
  function abortLoading() {
    if (state.loading) {
      state.loading.abort();
      state.loading = null;
    }
  }
  if (typeof icon === "object" && icon !== null && typeof icon.body === "string") {
    state.name = "";
    abortLoading();
    return {data: {...defaultIconProps, ...icon}};
  }
  let iconName;
  if (typeof icon !== "string" || (iconName = stringToIcon(icon, false, true)) === null) {
    abortLoading();
    return null;
  }
  const data = getIconData(iconName);
  if (!data) {
    if (mounted && (!state.loading || state.loading.name !== icon)) {
      abortLoading();
      state.name = "";
      state.loading = {
        name: icon,
        abort: loadIcons([iconName], callback)
      };
    }
    return null;
  }
  abortLoading();
  if (state.name !== icon) {
    state.name = icon;
    if (onload && !state.destroyed) {
      onload(icon);
    }
  }
  const classes = ["iconify"];
  if (iconName.prefix !== "") {
    classes.push("iconify--" + iconName.prefix);
  }
  if (iconName.provider !== "") {
    classes.push("iconify--" + iconName.provider);
  }
  return {data, classes};
}
function generateIcon(icon, props) {
  return icon ? render({
    ...defaultIconProps,
    ...icon
  }, props) : null;
}
var checkIconState_1 = checkIconState;
var generateIcon_1 = generateIcon;

/* generated by Svelte v3.58.0 */

function create_if_block(ctx) {
	let if_block_anchor;

	function select_block_type(ctx, dirty) {
		if (/*data*/ ctx[0].svg) return create_if_block_1;
		return create_else_block;
	}

	let current_block_type = select_block_type(ctx);
	let if_block = current_block_type(ctx);

	return {
		c() {
			if_block.c();
			if_block_anchor = empty();
		},
		l(nodes) {
			if_block.l(nodes);
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if_block.m(target, anchor);
			insert_hydration(target, if_block_anchor, anchor);
		},
		p(ctx, dirty) {
			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
				if_block.p(ctx, dirty);
			} else {
				if_block.d(1);
				if_block = current_block_type(ctx);

				if (if_block) {
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			}
		},
		d(detaching) {
			if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

// (115:1) {:else}
function create_else_block(ctx) {
	let span;
	let span_levels = [/*data*/ ctx[0].attributes];
	let span_data = {};

	for (let i = 0; i < span_levels.length; i += 1) {
		span_data = assign(span_data, span_levels[i]);
	}

	return {
		c() {
			span = element("span");
			this.h();
		},
		l(nodes) {
			span = claim_element(nodes, "SPAN", {});
			children(span).forEach(detach);
			this.h();
		},
		h() {
			set_attributes(span, span_data);
		},
		m(target, anchor) {
			insert_hydration(target, span, anchor);
		},
		p(ctx, dirty) {
			set_attributes(span, span_data = get_spread_update(span_levels, [dirty & /*data*/ 1 && /*data*/ ctx[0].attributes]));
		},
		d(detaching) {
			if (detaching) detach(span);
		}
	};
}

// (111:1) {#if data.svg}
function create_if_block_1(ctx) {
	let svg;
	let raw_value = /*data*/ ctx[0].body + "";
	let svg_levels = [/*data*/ ctx[0].attributes];
	let svg_data = {};

	for (let i = 0; i < svg_levels.length; i += 1) {
		svg_data = assign(svg_data, svg_levels[i]);
	}

	return {
		c() {
			svg = svg_element("svg");
			this.h();
		},
		l(nodes) {
			svg = claim_svg_element(nodes, "svg", {});
			var svg_nodes = children(svg);
			svg_nodes.forEach(detach);
			this.h();
		},
		h() {
			set_svg_attributes(svg, svg_data);
		},
		m(target, anchor) {
			insert_hydration(target, svg, anchor);
			svg.innerHTML = raw_value;
		},
		p(ctx, dirty) {
			if (dirty & /*data*/ 1 && raw_value !== (raw_value = /*data*/ ctx[0].body + "")) svg.innerHTML = raw_value;			set_svg_attributes(svg, svg_data = get_spread_update(svg_levels, [dirty & /*data*/ 1 && /*data*/ ctx[0].attributes]));
		},
		d(detaching) {
			if (detaching) detach(svg);
		}
	};
}

function create_fragment$1(ctx) {
	let if_block_anchor;
	let if_block = /*data*/ ctx[0] && create_if_block(ctx);

	return {
		c() {
			if (if_block) if_block.c();
			if_block_anchor = empty();
		},
		l(nodes) {
			if (if_block) if_block.l(nodes);
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if (if_block) if_block.m(target, anchor);
			insert_hydration(target, if_block_anchor, anchor);
		},
		p(ctx, [dirty]) {
			if (/*data*/ ctx[0]) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block(ctx);
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (if_block) if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	const state = {
		// Last icon name
		name: '',
		// Loading status
		loading: null,
		// Destroyed status
		destroyed: false
	};

	// Mounted status
	let mounted = false;

	// Callback counter
	let counter = 0;

	// Generated data
	let data;

	const onLoad = icon => {
		// Legacy onLoad property
		if (typeof $$props.onLoad === 'function') {
			$$props.onLoad(icon);
		}

		// on:load event
		const dispatch = createEventDispatcher();

		dispatch('load', { icon });
	};

	// Increase counter when loaded to force re-calculation of data
	function loaded() {
		$$invalidate(3, counter++, counter);
	}

	// Force re-render
	onMount(() => {
		$$invalidate(2, mounted = true);
	});

	// Abort loading when component is destroyed
	onDestroy(() => {
		$$invalidate(1, state.destroyed = true, state);

		if (state.loading) {
			state.loading.abort();
			$$invalidate(1, state.loading = null, state);
		}
	});

	$$self.$$set = $$new_props => {
		$$invalidate(6, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
	};

	$$self.$$.update = () => {
		 {
			const iconData = checkIconState_1($$props.icon, state, mounted, loaded, onLoad);
			$$invalidate(0, data = iconData ? generateIcon_1(iconData.data, $$props) : null);

			if (data && iconData.classes) {
				// Add classes
				$$invalidate(
					0,
					data.attributes['class'] = (typeof $$props['class'] === 'string'
					? $$props['class'] + ' '
					: '') + iconData.classes.join(' '),
					data
				);
			}
		}
	};

	$$props = exclude_internal_props($$props);
	return [data, state, mounted, counter];
}

class Component$1 extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[8] = list[i].link;
	return child_ctx;
}

function get_each_context_1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[8] = list[i].link;
	return child_ctx;
}

// (105:31) 
function create_if_block_4(ctx) {
	let img;
	let img_src_value;
	let img_alt_value;

	return {
		c() {
			img = element("img");
			this.h();
		},
		l(nodes) {
			img = claim_element(nodes, "IMG", { src: true, alt: true });
			this.h();
		},
		h() {
			if (!src_url_equal(img.src, img_src_value = /*logo*/ ctx[0].image.url)) attr(img, "src", img_src_value);
			attr(img, "alt", img_alt_value = /*logo*/ ctx[0].image.alt);
		},
		m(target, anchor) {
			insert_hydration(target, img, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 1 && !src_url_equal(img.src, img_src_value = /*logo*/ ctx[0].image.url)) {
				attr(img, "src", img_src_value);
			}

			if (dirty & /*logo*/ 1 && img_alt_value !== (img_alt_value = /*logo*/ ctx[0].image.alt)) {
				attr(img, "alt", img_alt_value);
			}
		},
		d(detaching) {
			if (detaching) detach(img);
		}
	};
}

// (103:6) {#if logo.title}
function create_if_block_3(ctx) {
	let t_value = /*logo*/ ctx[0].title + "";
	let t;

	return {
		c() {
			t = text(t_value);
		},
		l(nodes) {
			t = claim_text(nodes, t_value);
		},
		m(target, anchor) {
			insert_hydration(target, t, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 1 && t_value !== (t_value = /*logo*/ ctx[0].title + "")) set_data(t, t_value);
		},
		d(detaching) {
			if (detaching) detach(t);
		}
	};
}

// (110:6) {#each site_nav as { link }}
function create_each_block_1(ctx) {
	let a;
	let t_value = /*link*/ ctx[8].label + "";
	let t;
	let a_href_value;

	return {
		c() {
			a = element("a");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { class: true, href: true });
			var a_nodes = children(a);
			t = claim_text(a_nodes, t_value);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "class", "link svelte-1grguq5");
			attr(a, "href", a_href_value = /*link*/ ctx[8].url);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, t);
		},
		p(ctx, dirty) {
			if (dirty & /*site_nav*/ 2 && t_value !== (t_value = /*link*/ ctx[8].label + "")) set_data(t, t_value);

			if (dirty & /*site_nav*/ 2 && a_href_value !== (a_href_value = /*link*/ ctx[8].url)) {
				attr(a, "href", a_href_value);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
		}
	};
}

// (119:31) 
function create_if_block_2(ctx) {
	let img;
	let img_src_value;
	let img_alt_value;

	return {
		c() {
			img = element("img");
			this.h();
		},
		l(nodes) {
			img = claim_element(nodes, "IMG", { src: true, alt: true });
			this.h();
		},
		h() {
			if (!src_url_equal(img.src, img_src_value = /*logo*/ ctx[0].image.url)) attr(img, "src", img_src_value);
			attr(img, "alt", img_alt_value = /*logo*/ ctx[0].image.alt);
		},
		m(target, anchor) {
			insert_hydration(target, img, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 1 && !src_url_equal(img.src, img_src_value = /*logo*/ ctx[0].image.url)) {
				attr(img, "src", img_src_value);
			}

			if (dirty & /*logo*/ 1 && img_alt_value !== (img_alt_value = /*logo*/ ctx[0].image.alt)) {
				attr(img, "alt", img_alt_value);
			}
		},
		d(detaching) {
			if (detaching) detach(img);
		}
	};
}

// (117:6) {#if logo.title}
function create_if_block_1$1(ctx) {
	let t_value = /*logo*/ ctx[0].title + "";
	let t;

	return {
		c() {
			t = text(t_value);
		},
		l(nodes) {
			t = claim_text(nodes, t_value);
		},
		m(target, anchor) {
			insert_hydration(target, t, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 1 && t_value !== (t_value = /*logo*/ ctx[0].title + "")) set_data(t, t_value);
		},
		d(detaching) {
			if (detaching) detach(t);
		}
	};
}

// (129:4) {#if mobileNavOpen}
function create_if_block$1(ctx) {
	let nav;
	let t;
	let button;
	let icon;
	let nav_transition;
	let current;
	let mounted;
	let dispose;
	let each_value = /*site_nav*/ ctx[1];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
	}

	icon = new Component$1({ props: { height: "25", icon: "bi:x-lg" } });

	return {
		c() {
			nav = element("nav");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t = space();
			button = element("button");
			create_component(icon.$$.fragment);
			this.h();
		},
		l(nodes) {
			nav = claim_element(nodes, "NAV", { id: true, class: true });
			var nav_nodes = children(nav);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(nav_nodes);
			}

			t = claim_space(nav_nodes);

			button = claim_element(nav_nodes, "BUTTON", {
				id: true,
				"aria-label": true,
				class: true
			});

			var button_nodes = children(button);
			claim_component(icon.$$.fragment, button_nodes);
			button_nodes.forEach(detach);
			nav_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(button, "id", "close");
			attr(button, "aria-label", "Close Navigation");
			attr(button, "class", "svelte-1grguq5");
			attr(nav, "id", "popup");
			attr(nav, "class", "svelte-1grguq5");
		},
		m(target, anchor) {
			insert_hydration(target, nav, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(nav, null);
				}
			}

			append_hydration(nav, t);
			append_hydration(nav, button);
			mount_component(icon, button, null);
			current = true;

			if (!mounted) {
				dispose = listen(button, "click", /*click_handler_1*/ ctx[6]);
				mounted = true;
			}
		},
		p(ctx, dirty) {
			if (dirty & /*site_nav*/ 2) {
				each_value = /*site_nav*/ ctx[1];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(nav, t);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);

			add_render_callback(() => {
				if (!current) return;
				if (!nav_transition) nav_transition = create_bidirectional_transition(nav, fade, { duration: 200 }, true);
				nav_transition.run(1);
			});

			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			if (!nav_transition) nav_transition = create_bidirectional_transition(nav, fade, { duration: 200 }, false);
			nav_transition.run(0);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(nav);
			destroy_each(each_blocks, detaching);
			destroy_component(icon);
			if (detaching && nav_transition) nav_transition.end();
			mounted = false;
			dispose();
		}
	};
}

// (131:8) {#each site_nav as { link }}
function create_each_block(ctx) {
	let a;
	let t_value = /*link*/ ctx[8].label + "";
	let t;
	let a_href_value;

	return {
		c() {
			a = element("a");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { href: true });
			var a_nodes = children(a);
			t = claim_text(a_nodes, t_value);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "href", a_href_value = /*link*/ ctx[8].url);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, t);
		},
		p(ctx, dirty) {
			if (dirty & /*site_nav*/ 2 && t_value !== (t_value = /*link*/ ctx[8].label + "")) set_data(t, t_value);

			if (dirty & /*site_nav*/ 2 && a_href_value !== (a_href_value = /*link*/ ctx[8].url)) {
				attr(a, "href", a_href_value);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
		}
	};
}

function create_fragment$2(ctx) {
	let div2;
	let header;
	let div0;
	let a0;
	let t0;
	let nav;
	let t1;
	let div1;
	let a1;
	let t2;
	let button;
	let icon;
	let t3;
	let current;
	let mounted;
	let dispose;

	function select_block_type(ctx, dirty) {
		if (/*logo*/ ctx[0].title) return create_if_block_3;
		if (/*logo*/ ctx[0].image.url) return create_if_block_4;
	}

	let current_block_type = select_block_type(ctx);
	let if_block0 = current_block_type && current_block_type(ctx);
	let each_value_1 = /*site_nav*/ ctx[1];
	let each_blocks = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
	}

	function select_block_type_1(ctx, dirty) {
		if (/*logo*/ ctx[0].title) return create_if_block_1$1;
		if (/*logo*/ ctx[0].image.url) return create_if_block_2;
	}

	let current_block_type_1 = select_block_type_1(ctx);
	let if_block1 = current_block_type_1 && current_block_type_1(ctx);

	icon = new Component$1({
			props: { height: "30", icon: "eva:menu-outline" }
		});

	let if_block2 = /*mobileNavOpen*/ ctx[2] && create_if_block$1(ctx);

	return {
		c() {
			div2 = element("div");
			header = element("header");
			div0 = element("div");
			a0 = element("a");
			if (if_block0) if_block0.c();
			t0 = space();
			nav = element("nav");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t1 = space();
			div1 = element("div");
			a1 = element("a");
			if (if_block1) if_block1.c();
			t2 = space();
			button = element("button");
			create_component(icon.$$.fragment);
			t3 = space();
			if (if_block2) if_block2.c();
			this.h();
		},
		l(nodes) {
			div2 = claim_element(nodes, "DIV", { class: true, id: true });
			var div2_nodes = children(div2);
			header = claim_element(div2_nodes, "HEADER", { class: true });
			var header_nodes = children(header);
			div0 = claim_element(header_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			a0 = claim_element(div0_nodes, "A", { href: true, class: true });
			var a0_nodes = children(a0);
			if (if_block0) if_block0.l(a0_nodes);
			a0_nodes.forEach(detach);
			t0 = claim_space(div0_nodes);
			nav = claim_element(div0_nodes, "NAV", { class: true });
			var nav_nodes = children(nav);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(nav_nodes);
			}

			nav_nodes.forEach(detach);
			div0_nodes.forEach(detach);
			t1 = claim_space(header_nodes);
			div1 = claim_element(header_nodes, "DIV", { class: true });
			var div1_nodes = children(div1);
			a1 = claim_element(div1_nodes, "A", { href: true, class: true });
			var a1_nodes = children(a1);
			if (if_block1) if_block1.l(a1_nodes);
			a1_nodes.forEach(detach);
			t2 = claim_space(div1_nodes);
			button = claim_element(div1_nodes, "BUTTON", { id: true, "aria-label": true });
			var button_nodes = children(button);
			claim_component(icon.$$.fragment, button_nodes);
			button_nodes.forEach(detach);
			t3 = claim_space(div1_nodes);
			if (if_block2) if_block2.l(div1_nodes);
			div1_nodes.forEach(detach);
			header_nodes.forEach(detach);
			div2_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a0, "href", "/");
			attr(a0, "class", "logo svelte-1grguq5");
			attr(nav, "class", "svelte-1grguq5");
			attr(div0, "class", "desktop-nav svelte-1grguq5");
			attr(a1, "href", "/");
			attr(a1, "class", "logo svelte-1grguq5");
			attr(button, "id", "open");
			attr(button, "aria-label", "Open mobile navigation");
			attr(div1, "class", "mobile-nav svelte-1grguq5");
			attr(header, "class", "section-container svelte-1grguq5");
			attr(div2, "class", "section");
			attr(div2, "id", "section-63c48e67");
		},
		m(target, anchor) {
			insert_hydration(target, div2, anchor);
			append_hydration(div2, header);
			append_hydration(header, div0);
			append_hydration(div0, a0);
			if (if_block0) if_block0.m(a0, null);
			append_hydration(div0, t0);
			append_hydration(div0, nav);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(nav, null);
				}
			}

			append_hydration(header, t1);
			append_hydration(header, div1);
			append_hydration(div1, a1);
			if (if_block1) if_block1.m(a1, null);
			append_hydration(div1, t2);
			append_hydration(div1, button);
			mount_component(icon, button, null);
			append_hydration(div1, t3);
			if (if_block2) if_block2.m(div1, null);
			current = true;

			if (!mounted) {
				dispose = listen(button, "click", /*click_handler*/ ctx[5]);
				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block0) {
				if_block0.p(ctx, dirty);
			} else {
				if (if_block0) if_block0.d(1);
				if_block0 = current_block_type && current_block_type(ctx);

				if (if_block0) {
					if_block0.c();
					if_block0.m(a0, null);
				}
			}

			if (dirty & /*site_nav*/ 2) {
				each_value_1 = /*site_nav*/ ctx[1];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1(ctx, each_value_1, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block_1(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(nav, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value_1.length;
			}

			if (current_block_type_1 === (current_block_type_1 = select_block_type_1(ctx)) && if_block1) {
				if_block1.p(ctx, dirty);
			} else {
				if (if_block1) if_block1.d(1);
				if_block1 = current_block_type_1 && current_block_type_1(ctx);

				if (if_block1) {
					if_block1.c();
					if_block1.m(a1, null);
				}
			}

			if (/*mobileNavOpen*/ ctx[2]) {
				if (if_block2) {
					if_block2.p(ctx, dirty);

					if (dirty & /*mobileNavOpen*/ 4) {
						transition_in(if_block2, 1);
					}
				} else {
					if_block2 = create_if_block$1(ctx);
					if_block2.c();
					transition_in(if_block2, 1);
					if_block2.m(div1, null);
				}
			} else if (if_block2) {
				group_outros();

				transition_out(if_block2, 1, 1, () => {
					if_block2 = null;
				});

				check_outros();
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			transition_in(if_block2);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			transition_out(if_block2);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div2);

			if (if_block0) {
				if_block0.d();
			}

			destroy_each(each_blocks, detaching);

			if (if_block1) {
				if_block1.d();
			}

			destroy_component(icon);
			if (if_block2) if_block2.d();
			mounted = false;
			dispose();
		}
	};
}

function instance$2($$self, $$props, $$invalidate) {
	let { title } = $$props;
	let { favicon } = $$props;
	let { logo } = $$props;
	let { site_nav } = $$props;
	let mobileNavOpen = false;

	const click_handler = () => $$invalidate(2, mobileNavOpen = true);
	const click_handler_1 = () => $$invalidate(2, mobileNavOpen = false);

	$$self.$$set = $$props => {
		if ('title' in $$props) $$invalidate(3, title = $$props.title);
		if ('favicon' in $$props) $$invalidate(4, favicon = $$props.favicon);
		if ('logo' in $$props) $$invalidate(0, logo = $$props.logo);
		if ('site_nav' in $$props) $$invalidate(1, site_nav = $$props.site_nav);
	};

	return [logo, site_nav, mobileNavOpen, title, favicon, click_handler, click_handler_1];
}

class Component$2 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$2, create_fragment$2, safe_not_equal, {
			title: 3,
			favicon: 4,
			logo: 0,
			site_nav: 1
		});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[8] = list[i];
	child_ctx[10] = i;
	return child_ctx;
}

// (146:6) {#if isActive[i]}
function create_if_block$2(ctx) {
	let div;
	let raw_value = /*item*/ ctx[8].description.html + "";
	let div_transition;
	let current;

	return {
		c() {
			div = element("div");
			this.h();
		},
		l(nodes) {
			div = claim_element(nodes, "DIV", { class: true });
			var div_nodes = children(div);
			div_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(div, "class", "description content svelte-12ft0zk");
		},
		m(target, anchor) {
			insert_hydration(target, div, anchor);
			div.innerHTML = raw_value;
			current = true;
		},
		p(ctx, dirty) {
			if ((!current || dirty & /*items*/ 2) && raw_value !== (raw_value = /*item*/ ctx[8].description.html + "")) div.innerHTML = raw_value;		},
		i(local) {
			if (current) return;

			add_render_callback(() => {
				if (!current) return;
				if (!div_transition) div_transition = create_bidirectional_transition(div, slide, {}, true);
				div_transition.run(1);
			});

			current = true;
		},
		o(local) {
			if (!div_transition) div_transition = create_bidirectional_transition(div, slide, {}, false);
			div_transition.run(0);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);
			if (detaching && div_transition) div_transition.end();
		}
	};
}

// (138:4) {#each items as item, i (i)}
function create_each_block$1(key_1, ctx) {
	let div;
	let button;
	let span0;
	let t0_value = /*i*/ ctx[10] + 1 + "";
	let t0;
	let t1;
	let t2_value = /*item*/ ctx[8].title + "";
	let t2;
	let t3;
	let span1;
	let icon;
	let t4;
	let t5;
	let current;
	let mounted;
	let dispose;
	icon = new Component$1({ props: { icon: "ph:caret-down-bold" } });

	function click_handler() {
		return /*click_handler*/ ctx[6](/*i*/ ctx[10]);
	}

	let if_block = /*isActive*/ ctx[2][/*i*/ ctx[10]] && create_if_block$2(ctx);

	return {
		key: key_1,
		first: null,
		c() {
			div = element("div");
			button = element("button");
			span0 = element("span");
			t0 = text(t0_value);
			t1 = text(". ");
			t2 = text(t2_value);
			t3 = space();
			span1 = element("span");
			create_component(icon.$$.fragment);
			t4 = space();
			if (if_block) if_block.c();
			t5 = space();
			this.h();
		},
		l(nodes) {
			div = claim_element(nodes, "DIV", { class: true });
			var div_nodes = children(div);
			button = claim_element(div_nodes, "BUTTON", { class: true });
			var button_nodes = children(button);
			span0 = claim_element(button_nodes, "SPAN", { class: true });
			var span0_nodes = children(span0);
			t0 = claim_text(span0_nodes, t0_value);
			t1 = claim_text(span0_nodes, ". ");
			t2 = claim_text(span0_nodes, t2_value);
			span0_nodes.forEach(detach);
			t3 = claim_space(button_nodes);
			span1 = claim_element(button_nodes, "SPAN", { class: true });
			var span1_nodes = children(span1);
			claim_component(icon.$$.fragment, span1_nodes);
			span1_nodes.forEach(detach);
			button_nodes.forEach(detach);
			t4 = claim_space(div_nodes);
			if (if_block) if_block.l(div_nodes);
			t5 = claim_space(div_nodes);
			div_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(span0, "class", "svelte-12ft0zk");
			attr(span1, "class", "icon svelte-12ft0zk");
			attr(button, "class", "svelte-12ft0zk");
			attr(div, "class", "item svelte-12ft0zk");
			toggle_class(div, "active", /*isActive*/ ctx[2][/*i*/ ctx[10]]);
			this.first = div;
		},
		m(target, anchor) {
			insert_hydration(target, div, anchor);
			append_hydration(div, button);
			append_hydration(button, span0);
			append_hydration(span0, t0);
			append_hydration(span0, t1);
			append_hydration(span0, t2);
			append_hydration(button, t3);
			append_hydration(button, span1);
			mount_component(icon, span1, null);
			append_hydration(div, t4);
			if (if_block) if_block.m(div, null);
			append_hydration(div, t5);
			current = true;

			if (!mounted) {
				dispose = listen(button, "click", click_handler);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if ((!current || dirty & /*items*/ 2) && t0_value !== (t0_value = /*i*/ ctx[10] + 1 + "")) set_data(t0, t0_value);
			if ((!current || dirty & /*items*/ 2) && t2_value !== (t2_value = /*item*/ ctx[8].title + "")) set_data(t2, t2_value);

			if (/*isActive*/ ctx[2][/*i*/ ctx[10]]) {
				if (if_block) {
					if_block.p(ctx, dirty);

					if (dirty & /*isActive, items*/ 6) {
						transition_in(if_block, 1);
					}
				} else {
					if_block = create_if_block$2(ctx);
					if_block.c();
					transition_in(if_block, 1);
					if_block.m(div, t5);
				}
			} else if (if_block) {
				group_outros();

				transition_out(if_block, 1, 1, () => {
					if_block = null;
				});

				check_outros();
			}

			if (!current || dirty & /*isActive, items*/ 6) {
				toggle_class(div, "active", /*isActive*/ ctx[2][/*i*/ ctx[10]]);
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			transition_in(if_block);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			transition_out(if_block);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);
			destroy_component(icon);
			if (if_block) if_block.d();
			mounted = false;
			dispose();
		}
	};
}

function create_fragment$3(ctx) {
	let div1;
	let section;
	let h2;
	let t0;
	let t1;
	let div0;
	let each_blocks = [];
	let each_1_lookup = new Map();
	let current;
	let each_value = /*items*/ ctx[1];
	const get_key = ctx => /*i*/ ctx[10];

	for (let i = 0; i < each_value.length; i += 1) {
		let child_ctx = get_each_context$1(ctx, each_value, i);
		let key = get_key(child_ctx);
		each_1_lookup.set(key, each_blocks[i] = create_each_block$1(key, child_ctx));
	}

	return {
		c() {
			div1 = element("div");
			section = element("section");
			h2 = element("h2");
			t0 = text(/*heading*/ ctx[0]);
			t1 = space();
			div0 = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			this.h();
		},
		l(nodes) {
			div1 = claim_element(nodes, "DIV", { class: true, id: true });
			var div1_nodes = children(div1);
			section = claim_element(div1_nodes, "SECTION", { class: true });
			var section_nodes = children(section);
			h2 = claim_element(section_nodes, "H2", { class: true });
			var h2_nodes = children(h2);
			t0 = claim_text(h2_nodes, /*heading*/ ctx[0]);
			h2_nodes.forEach(detach);
			t1 = claim_space(section_nodes);
			div0 = claim_element(section_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(div0_nodes);
			}

			div0_nodes.forEach(detach);
			section_nodes.forEach(detach);
			div1_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(h2, "class", "heading svelte-12ft0zk");
			attr(div0, "class", "accordion svelte-12ft0zk");
			attr(section, "class", "section-container svelte-12ft0zk");
			attr(div1, "class", "section");
			attr(div1, "id", "section-bddbbd11");
		},
		m(target, anchor) {
			insert_hydration(target, div1, anchor);
			append_hydration(div1, section);
			append_hydration(section, h2);
			append_hydration(h2, t0);
			append_hydration(section, t1);
			append_hydration(section, div0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(div0, null);
				}
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (!current || dirty & /*heading*/ 1) set_data(t0, /*heading*/ ctx[0]);

			if (dirty & /*isActive, items, toggleItem*/ 14) {
				each_value = /*items*/ ctx[1];
				group_outros();
				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each_1_lookup, div0, outro_and_destroy_block, create_each_block$1, null, get_each_context$1);
				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div1);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].d();
			}
		}
	};
}

function instance$3($$self, $$props, $$invalidate) {
	let { title } = $$props;
	let { favicon } = $$props;
	let { heading } = $$props;
	let { items } = $$props;
	const isActive = items.map(i => false);

	const toggleItem = i => {
		$$invalidate(2, isActive[i] = !isActive[i], isActive);
	};

	const click_handler = i => toggleItem(i);

	$$self.$$set = $$props => {
		if ('title' in $$props) $$invalidate(4, title = $$props.title);
		if ('favicon' in $$props) $$invalidate(5, favicon = $$props.favicon);
		if ('heading' in $$props) $$invalidate(0, heading = $$props.heading);
		if ('items' in $$props) $$invalidate(1, items = $$props.items);
	};

	return [heading, items, isActive, toggleItem, title, favicon, click_handler];
}

class Component$3 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$3, create_fragment$3, safe_not_equal, {
			title: 4,
			favicon: 5,
			heading: 0,
			items: 1
		});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$2(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[8] = list[i];
	child_ctx[10] = i;
	return child_ctx;
}

// (146:6) {#if isActive[i]}
function create_if_block$3(ctx) {
	let div;
	let raw_value = /*item*/ ctx[8].description.html + "";
	let div_transition;
	let current;

	return {
		c() {
			div = element("div");
			this.h();
		},
		l(nodes) {
			div = claim_element(nodes, "DIV", { class: true });
			var div_nodes = children(div);
			div_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(div, "class", "description content svelte-12ft0zk");
		},
		m(target, anchor) {
			insert_hydration(target, div, anchor);
			div.innerHTML = raw_value;
			current = true;
		},
		p(ctx, dirty) {
			if ((!current || dirty & /*items*/ 2) && raw_value !== (raw_value = /*item*/ ctx[8].description.html + "")) div.innerHTML = raw_value;		},
		i(local) {
			if (current) return;

			add_render_callback(() => {
				if (!current) return;
				if (!div_transition) div_transition = create_bidirectional_transition(div, slide, {}, true);
				div_transition.run(1);
			});

			current = true;
		},
		o(local) {
			if (!div_transition) div_transition = create_bidirectional_transition(div, slide, {}, false);
			div_transition.run(0);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);
			if (detaching && div_transition) div_transition.end();
		}
	};
}

// (138:4) {#each items as item, i (i)}
function create_each_block$2(key_1, ctx) {
	let div;
	let button;
	let span0;
	let t0_value = /*i*/ ctx[10] + 1 + "";
	let t0;
	let t1;
	let t2_value = /*item*/ ctx[8].title + "";
	let t2;
	let t3;
	let span1;
	let icon;
	let t4;
	let t5;
	let current;
	let mounted;
	let dispose;
	icon = new Component$1({ props: { icon: "ph:caret-down-bold" } });

	function click_handler() {
		return /*click_handler*/ ctx[6](/*i*/ ctx[10]);
	}

	let if_block = /*isActive*/ ctx[2][/*i*/ ctx[10]] && create_if_block$3(ctx);

	return {
		key: key_1,
		first: null,
		c() {
			div = element("div");
			button = element("button");
			span0 = element("span");
			t0 = text(t0_value);
			t1 = text(". ");
			t2 = text(t2_value);
			t3 = space();
			span1 = element("span");
			create_component(icon.$$.fragment);
			t4 = space();
			if (if_block) if_block.c();
			t5 = space();
			this.h();
		},
		l(nodes) {
			div = claim_element(nodes, "DIV", { class: true });
			var div_nodes = children(div);
			button = claim_element(div_nodes, "BUTTON", { class: true });
			var button_nodes = children(button);
			span0 = claim_element(button_nodes, "SPAN", { class: true });
			var span0_nodes = children(span0);
			t0 = claim_text(span0_nodes, t0_value);
			t1 = claim_text(span0_nodes, ". ");
			t2 = claim_text(span0_nodes, t2_value);
			span0_nodes.forEach(detach);
			t3 = claim_space(button_nodes);
			span1 = claim_element(button_nodes, "SPAN", { class: true });
			var span1_nodes = children(span1);
			claim_component(icon.$$.fragment, span1_nodes);
			span1_nodes.forEach(detach);
			button_nodes.forEach(detach);
			t4 = claim_space(div_nodes);
			if (if_block) if_block.l(div_nodes);
			t5 = claim_space(div_nodes);
			div_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(span0, "class", "svelte-12ft0zk");
			attr(span1, "class", "icon svelte-12ft0zk");
			attr(button, "class", "svelte-12ft0zk");
			attr(div, "class", "item svelte-12ft0zk");
			toggle_class(div, "active", /*isActive*/ ctx[2][/*i*/ ctx[10]]);
			this.first = div;
		},
		m(target, anchor) {
			insert_hydration(target, div, anchor);
			append_hydration(div, button);
			append_hydration(button, span0);
			append_hydration(span0, t0);
			append_hydration(span0, t1);
			append_hydration(span0, t2);
			append_hydration(button, t3);
			append_hydration(button, span1);
			mount_component(icon, span1, null);
			append_hydration(div, t4);
			if (if_block) if_block.m(div, null);
			append_hydration(div, t5);
			current = true;

			if (!mounted) {
				dispose = listen(button, "click", click_handler);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if ((!current || dirty & /*items*/ 2) && t0_value !== (t0_value = /*i*/ ctx[10] + 1 + "")) set_data(t0, t0_value);
			if ((!current || dirty & /*items*/ 2) && t2_value !== (t2_value = /*item*/ ctx[8].title + "")) set_data(t2, t2_value);

			if (/*isActive*/ ctx[2][/*i*/ ctx[10]]) {
				if (if_block) {
					if_block.p(ctx, dirty);

					if (dirty & /*isActive, items*/ 6) {
						transition_in(if_block, 1);
					}
				} else {
					if_block = create_if_block$3(ctx);
					if_block.c();
					transition_in(if_block, 1);
					if_block.m(div, t5);
				}
			} else if (if_block) {
				group_outros();

				transition_out(if_block, 1, 1, () => {
					if_block = null;
				});

				check_outros();
			}

			if (!current || dirty & /*isActive, items*/ 6) {
				toggle_class(div, "active", /*isActive*/ ctx[2][/*i*/ ctx[10]]);
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			transition_in(if_block);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			transition_out(if_block);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);
			destroy_component(icon);
			if (if_block) if_block.d();
			mounted = false;
			dispose();
		}
	};
}

function create_fragment$4(ctx) {
	let div1;
	let section;
	let h2;
	let t0;
	let t1;
	let div0;
	let each_blocks = [];
	let each_1_lookup = new Map();
	let current;
	let each_value = /*items*/ ctx[1];
	const get_key = ctx => /*i*/ ctx[10];

	for (let i = 0; i < each_value.length; i += 1) {
		let child_ctx = get_each_context$2(ctx, each_value, i);
		let key = get_key(child_ctx);
		each_1_lookup.set(key, each_blocks[i] = create_each_block$2(key, child_ctx));
	}

	return {
		c() {
			div1 = element("div");
			section = element("section");
			h2 = element("h2");
			t0 = text(/*heading*/ ctx[0]);
			t1 = space();
			div0 = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			this.h();
		},
		l(nodes) {
			div1 = claim_element(nodes, "DIV", { class: true, id: true });
			var div1_nodes = children(div1);
			section = claim_element(div1_nodes, "SECTION", { class: true });
			var section_nodes = children(section);
			h2 = claim_element(section_nodes, "H2", { class: true });
			var h2_nodes = children(h2);
			t0 = claim_text(h2_nodes, /*heading*/ ctx[0]);
			h2_nodes.forEach(detach);
			t1 = claim_space(section_nodes);
			div0 = claim_element(section_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(div0_nodes);
			}

			div0_nodes.forEach(detach);
			section_nodes.forEach(detach);
			div1_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(h2, "class", "heading svelte-12ft0zk");
			attr(div0, "class", "accordion svelte-12ft0zk");
			attr(section, "class", "section-container svelte-12ft0zk");
			attr(div1, "class", "section");
			attr(div1, "id", "section-c5cea428");
		},
		m(target, anchor) {
			insert_hydration(target, div1, anchor);
			append_hydration(div1, section);
			append_hydration(section, h2);
			append_hydration(h2, t0);
			append_hydration(section, t1);
			append_hydration(section, div0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(div0, null);
				}
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (!current || dirty & /*heading*/ 1) set_data(t0, /*heading*/ ctx[0]);

			if (dirty & /*isActive, items, toggleItem*/ 14) {
				each_value = /*items*/ ctx[1];
				group_outros();
				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each_1_lookup, div0, outro_and_destroy_block, create_each_block$2, null, get_each_context$2);
				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div1);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].d();
			}
		}
	};
}

function instance$4($$self, $$props, $$invalidate) {
	let { title } = $$props;
	let { favicon } = $$props;
	let { heading } = $$props;
	let { items } = $$props;
	const isActive = items.map(i => false);

	const toggleItem = i => {
		$$invalidate(2, isActive[i] = !isActive[i], isActive);
	};

	const click_handler = i => toggleItem(i);

	$$self.$$set = $$props => {
		if ('title' in $$props) $$invalidate(4, title = $$props.title);
		if ('favicon' in $$props) $$invalidate(5, favicon = $$props.favicon);
		if ('heading' in $$props) $$invalidate(0, heading = $$props.heading);
		if ('items' in $$props) $$invalidate(1, items = $$props.items);
	};

	return [heading, items, isActive, toggleItem, title, favicon, click_handler];
}

class Component$4 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$4, create_fragment$4, safe_not_equal, {
			title: 4,
			favicon: 5,
			heading: 0,
			items: 1
		});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$3(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[5] = list[i];
	return child_ctx;
}

function get_each_context_1$1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[8] = list[i].link;
	child_ctx[9] = list[i].icon;
	return child_ctx;
}

// (107:6) {#if org.image.url}
function create_if_block$4(ctx) {
	let figure;
	let img;
	let img_alt_value;
	let img_src_value;

	return {
		c() {
			figure = element("figure");
			img = element("img");
			this.h();
		},
		l(nodes) {
			figure = claim_element(nodes, "FIGURE", { class: true });
			var figure_nodes = children(figure);
			img = claim_element(figure_nodes, "IMG", { alt: true, src: true, class: true });
			figure_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(img, "alt", img_alt_value = /*org*/ ctx[5].image.alt);
			if (!src_url_equal(img.src, img_src_value = /*org*/ ctx[5].image.url)) attr(img, "src", img_src_value);
			attr(img, "class", "svelte-1eqlbb8");
			attr(figure, "class", "svelte-1eqlbb8");
		},
		m(target, anchor) {
			insert_hydration(target, figure, anchor);
			append_hydration(figure, img);
		},
		p(ctx, dirty) {
			if (dirty & /*orgs*/ 4 && img_alt_value !== (img_alt_value = /*org*/ ctx[5].image.alt)) {
				attr(img, "alt", img_alt_value);
			}

			if (dirty & /*orgs*/ 4 && !src_url_equal(img.src, img_src_value = /*org*/ ctx[5].image.url)) {
				attr(img, "src", img_src_value);
			}
		},
		d(detaching) {
			if (detaching) detach(figure);
		}
	};
}

// (117:10) {#each org.social_links as {link, icon}}
function create_each_block_1$1(ctx) {
	let a;
	let icon;
	let t;
	let a_href_value;
	let a_aria_label_value;
	let current;
	icon = new Component$1({ props: { icon: /*icon*/ ctx[9] } });

	return {
		c() {
			a = element("a");
			create_component(icon.$$.fragment);
			t = space();
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", {
				href: true,
				"aria-label": true,
				target: true,
				class: true
			});

			var a_nodes = children(a);
			claim_component(icon.$$.fragment, a_nodes);
			t = claim_space(a_nodes);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "href", a_href_value = /*link*/ ctx[8].url);
			attr(a, "aria-label", a_aria_label_value = /*link*/ ctx[8].label);
			attr(a, "target", "_blank");
			attr(a, "class", "svelte-1eqlbb8");
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			mount_component(icon, a, null);
			append_hydration(a, t);
			current = true;
		},
		p(ctx, dirty) {
			const icon_changes = {};
			if (dirty & /*orgs*/ 4) icon_changes.icon = /*icon*/ ctx[9];
			icon.$set(icon_changes);

			if (!current || dirty & /*orgs*/ 4 && a_href_value !== (a_href_value = /*link*/ ctx[8].url)) {
				attr(a, "href", a_href_value);
			}

			if (!current || dirty & /*orgs*/ 4 && a_aria_label_value !== (a_aria_label_value = /*link*/ ctx[8].label)) {
				attr(a, "aria-label", a_aria_label_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(a);
			destroy_component(icon);
		}
	};
}

// (105:4) {#each orgs as org}
function create_each_block$3(ctx) {
	let li;
	let t0;
	let div2;
	let div0;
	let span;
	let t1_value = /*org*/ ctx[5].name + "";
	let t1;
	let t2;
	let div1;
	let t3;
	let li_onclick_value;
	let current;
	let if_block = /*org*/ ctx[5].image.url && create_if_block$4(ctx);
	let each_value_1 = /*org*/ ctx[5].social_links;
	let each_blocks = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks[i] = create_each_block_1$1(get_each_context_1$1(ctx, each_value_1, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			li = element("li");
			if (if_block) if_block.c();
			t0 = space();
			div2 = element("div");
			div0 = element("div");
			span = element("span");
			t1 = text(t1_value);
			t2 = space();
			div1 = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t3 = space();
			this.h();
		},
		l(nodes) {
			li = claim_element(nodes, "LI", { onclick: true, class: true });
			var li_nodes = children(li);
			if (if_block) if_block.l(li_nodes);
			t0 = claim_space(li_nodes);
			div2 = claim_element(li_nodes, "DIV", { class: true });
			var div2_nodes = children(div2);
			div0 = claim_element(div2_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			span = claim_element(div0_nodes, "SPAN", { class: true });
			var span_nodes = children(span);
			t1 = claim_text(span_nodes, t1_value);
			span_nodes.forEach(detach);
			div0_nodes.forEach(detach);
			t2 = claim_space(div2_nodes);
			div1 = claim_element(div2_nodes, "DIV", { class: true });
			var div1_nodes = children(div1);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(div1_nodes);
			}

			div1_nodes.forEach(detach);
			div2_nodes.forEach(detach);
			t3 = claim_space(li_nodes);
			li_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(span, "class", "name svelte-1eqlbb8");
			attr(div0, "class", "details svelte-1eqlbb8");
			attr(div1, "class", "social svelte-1eqlbb8");
			attr(div2, "class", "info");
			attr(li, "onclick", li_onclick_value = "window.open('" + /*org*/ ctx[5].link + "', '_blank')");
			attr(li, "class", "svelte-1eqlbb8");
		},
		m(target, anchor) {
			insert_hydration(target, li, anchor);
			if (if_block) if_block.m(li, null);
			append_hydration(li, t0);
			append_hydration(li, div2);
			append_hydration(div2, div0);
			append_hydration(div0, span);
			append_hydration(span, t1);
			append_hydration(div2, t2);
			append_hydration(div2, div1);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(div1, null);
				}
			}

			append_hydration(li, t3);
			current = true;
		},
		p(ctx, dirty) {
			if (/*org*/ ctx[5].image.url) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block$4(ctx);
					if_block.c();
					if_block.m(li, t0);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}

			if ((!current || dirty & /*orgs*/ 4) && t1_value !== (t1_value = /*org*/ ctx[5].name + "")) set_data(t1, t1_value);

			if (dirty & /*orgs*/ 4) {
				each_value_1 = /*org*/ ctx[5].social_links;
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1$1(ctx, each_value_1, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block_1$1(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(div1, null);
					}
				}

				group_outros();

				for (i = each_value_1.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}

			if (!current || dirty & /*orgs*/ 4 && li_onclick_value !== (li_onclick_value = "window.open('" + /*org*/ ctx[5].link + "', '_blank')")) {
				attr(li, "onclick", li_onclick_value);
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value_1.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(li);
			if (if_block) if_block.d();
			destroy_each(each_blocks, detaching);
		}
	};
}

function create_fragment$5(ctx) {
	let div;
	let section;
	let h2;
	let t0;
	let t1;
	let span;
	let t2;
	let t3;
	let ul;
	let current;
	let each_value = /*orgs*/ ctx[2];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$3(get_each_context$3(ctx, each_value, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			div = element("div");
			section = element("section");
			h2 = element("h2");
			t0 = text(/*heading*/ ctx[0]);
			t1 = space();
			span = element("span");
			t2 = text(/*subheading*/ ctx[1]);
			t3 = space();
			ul = element("ul");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			this.h();
		},
		l(nodes) {
			div = claim_element(nodes, "DIV", { class: true, id: true });
			var div_nodes = children(div);
			section = claim_element(div_nodes, "SECTION", { class: true, id: true });
			var section_nodes = children(section);
			h2 = claim_element(section_nodes, "H2", { class: true });
			var h2_nodes = children(h2);
			t0 = claim_text(h2_nodes, /*heading*/ ctx[0]);
			h2_nodes.forEach(detach);
			t1 = claim_space(section_nodes);
			span = claim_element(section_nodes, "SPAN", { class: true });
			var span_nodes = children(span);
			t2 = claim_text(span_nodes, /*subheading*/ ctx[1]);
			span_nodes.forEach(detach);
			t3 = claim_space(section_nodes);
			ul = claim_element(section_nodes, "UL", { class: true });
			var ul_nodes = children(ul);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(ul_nodes);
			}

			ul_nodes.forEach(detach);
			section_nodes.forEach(detach);
			div_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(h2, "class", "heading svelte-1eqlbb8");
			attr(span, "class", "subheading svelte-1eqlbb8");
			attr(ul, "class", "cards svelte-1eqlbb8");
			attr(section, "class", "section-container svelte-1eqlbb8");
			attr(section, "id", "about");
			attr(div, "class", "section");
			attr(div, "id", "section-4ba96f8e");
		},
		m(target, anchor) {
			insert_hydration(target, div, anchor);
			append_hydration(div, section);
			append_hydration(section, h2);
			append_hydration(h2, t0);
			append_hydration(section, t1);
			append_hydration(section, span);
			append_hydration(span, t2);
			append_hydration(section, t3);
			append_hydration(section, ul);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(ul, null);
				}
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (!current || dirty & /*heading*/ 1) set_data(t0, /*heading*/ ctx[0]);
			if (!current || dirty & /*subheading*/ 2) set_data(t2, /*subheading*/ ctx[1]);

			if (dirty & /*orgs*/ 4) {
				each_value = /*orgs*/ ctx[2];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$3(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block$3(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(ul, null);
					}
				}

				group_outros();

				for (i = each_value.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);
			destroy_each(each_blocks, detaching);
		}
	};
}

function instance$5($$self, $$props, $$invalidate) {
	let { title } = $$props;
	let { favicon } = $$props;
	let { heading } = $$props;
	let { subheading } = $$props;
	let { orgs } = $$props;

	$$self.$$set = $$props => {
		if ('title' in $$props) $$invalidate(3, title = $$props.title);
		if ('favicon' in $$props) $$invalidate(4, favicon = $$props.favicon);
		if ('heading' in $$props) $$invalidate(0, heading = $$props.heading);
		if ('subheading' in $$props) $$invalidate(1, subheading = $$props.subheading);
		if ('orgs' in $$props) $$invalidate(2, orgs = $$props.orgs);
	};

	return [heading, subheading, orgs, title, favicon];
}

class Component$5 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$5, create_fragment$5, safe_not_equal, {
			title: 3,
			favicon: 4,
			heading: 0,
			subheading: 1,
			orgs: 2
		});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$4(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[4] = list[i].link;
	child_ctx[5] = list[i].icon;
	return child_ctx;
}

function get_each_context_1$2(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[4] = list[i].link;
	return child_ctx;
}

// (66:4) {#each nav as { link }}
function create_each_block_1$2(ctx) {
	let a;
	let t_value = /*link*/ ctx[4].label + "";
	let t;
	let a_href_value;

	return {
		c() {
			a = element("a");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { class: true, href: true });
			var a_nodes = children(a);
			t = claim_text(a_nodes, t_value);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "class", "link svelte-i9k4w2");
			attr(a, "href", a_href_value = /*link*/ ctx[4].url);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, t);
		},
		p(ctx, dirty) {
			if (dirty & /*nav*/ 1 && t_value !== (t_value = /*link*/ ctx[4].label + "")) set_data(t, t_value);

			if (dirty & /*nav*/ 1 && a_href_value !== (a_href_value = /*link*/ ctx[4].url)) {
				attr(a, "href", a_href_value);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
		}
	};
}

// (71:4) {#each social as { link, icon }}
function create_each_block$4(ctx) {
	let a;
	let icon;
	let t;
	let a_href_value;
	let a_aria_label_value;
	let current;
	icon = new Component$1({ props: { icon: /*icon*/ ctx[5] } });

	return {
		c() {
			a = element("a");
			create_component(icon.$$.fragment);
			t = space();
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", {
				href: true,
				"aria-label": true,
				class: true
			});

			var a_nodes = children(a);
			claim_component(icon.$$.fragment, a_nodes);
			t = claim_space(a_nodes);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "href", a_href_value = /*link*/ ctx[4].url);
			attr(a, "aria-label", a_aria_label_value = /*link*/ ctx[4].label);
			attr(a, "class", "svelte-i9k4w2");
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			mount_component(icon, a, null);
			append_hydration(a, t);
			current = true;
		},
		p(ctx, dirty) {
			const icon_changes = {};
			if (dirty & /*social*/ 2) icon_changes.icon = /*icon*/ ctx[5];
			icon.$set(icon_changes);

			if (!current || dirty & /*social*/ 2 && a_href_value !== (a_href_value = /*link*/ ctx[4].url)) {
				attr(a, "href", a_href_value);
			}

			if (!current || dirty & /*social*/ 2 && a_aria_label_value !== (a_aria_label_value = /*link*/ ctx[4].label)) {
				attr(a, "aria-label", a_aria_label_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(a);
			destroy_component(icon);
		}
	};
}

function create_fragment$6(ctx) {
	let div1;
	let footer;
	let nav_1;
	let t;
	let div0;
	let current;
	let each_value_1 = /*nav*/ ctx[0];
	let each_blocks_1 = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks_1[i] = create_each_block_1$2(get_each_context_1$2(ctx, each_value_1, i));
	}

	let each_value = /*social*/ ctx[1];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$4(get_each_context$4(ctx, each_value, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			div1 = element("div");
			footer = element("footer");
			nav_1 = element("nav");

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].c();
			}

			t = space();
			div0 = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			this.h();
		},
		l(nodes) {
			div1 = claim_element(nodes, "DIV", { class: true, id: true });
			var div1_nodes = children(div1);
			footer = claim_element(div1_nodes, "FOOTER", { class: true });
			var footer_nodes = children(footer);
			nav_1 = claim_element(footer_nodes, "NAV", { class: true });
			var nav_1_nodes = children(nav_1);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].l(nav_1_nodes);
			}

			nav_1_nodes.forEach(detach);
			t = claim_space(footer_nodes);
			div0 = claim_element(footer_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(div0_nodes);
			}

			div0_nodes.forEach(detach);
			footer_nodes.forEach(detach);
			div1_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(nav_1, "class", "svelte-i9k4w2");
			attr(div0, "class", "social-links svelte-i9k4w2");
			attr(footer, "class", "section-container svelte-i9k4w2");
			attr(div1, "class", "section");
			attr(div1, "id", "section-f3b9f58f");
		},
		m(target, anchor) {
			insert_hydration(target, div1, anchor);
			append_hydration(div1, footer);
			append_hydration(footer, nav_1);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				if (each_blocks_1[i]) {
					each_blocks_1[i].m(nav_1, null);
				}
			}

			append_hydration(footer, t);
			append_hydration(footer, div0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(div0, null);
				}
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (dirty & /*nav*/ 1) {
				each_value_1 = /*nav*/ ctx[0];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1$2(ctx, each_value_1, i);

					if (each_blocks_1[i]) {
						each_blocks_1[i].p(child_ctx, dirty);
					} else {
						each_blocks_1[i] = create_each_block_1$2(child_ctx);
						each_blocks_1[i].c();
						each_blocks_1[i].m(nav_1, null);
					}
				}

				for (; i < each_blocks_1.length; i += 1) {
					each_blocks_1[i].d(1);
				}

				each_blocks_1.length = each_value_1.length;
			}

			if (dirty & /*social*/ 2) {
				each_value = /*social*/ ctx[1];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$4(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block$4(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(div0, null);
					}
				}

				group_outros();

				for (i = each_value.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div1);
			destroy_each(each_blocks_1, detaching);
			destroy_each(each_blocks, detaching);
		}
	};
}

function instance$6($$self, $$props, $$invalidate) {
	let { title } = $$props;
	let { favicon } = $$props;
	let { nav } = $$props;
	let { social } = $$props;

	$$self.$$set = $$props => {
		if ('title' in $$props) $$invalidate(2, title = $$props.title);
		if ('favicon' in $$props) $$invalidate(3, favicon = $$props.favicon);
		if ('nav' in $$props) $$invalidate(0, nav = $$props.nav);
		if ('social' in $$props) $$invalidate(1, social = $$props.social);
	};

	return [nav, social, title, favicon];
}

class Component$6 extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$6, create_fragment$6, safe_not_equal, { title: 2, favicon: 3, nav: 0, social: 1 });
	}
}

/* generated by Svelte v3.58.0 */

function instance$7($$self, $$props, $$invalidate) {
	let { title } = $$props;
	let { favicon } = $$props;

	$$self.$$set = $$props => {
		if ('title' in $$props) $$invalidate(0, title = $$props.title);
		if ('favicon' in $$props) $$invalidate(1, favicon = $$props.favicon);
	};

	return [title, favicon];
}

class Component$7 extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$7, null, safe_not_equal, { title: 0, favicon: 1 });
	}
}

/* generated by Svelte v3.58.0 */

function create_fragment$7(ctx) {
	let component_0;
	let t0;
	let component_1;
	let t1;
	let component_2;
	let t2;
	let component_3;
	let t3;
	let component_4;
	let t4;
	let component_5;
	let t5;
	let component_6;
	let current;

	component_0 = new Component({
			props: {
				title: "More Homes Canada",
				favicon: {
					"alt": "house favicon",
					"src": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"url": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"size": 1
				}
			}
		});

	component_1 = new Component$2({
			props: {
				title: "More Homes Canada",
				favicon: {
					"alt": "house favicon",
					"src": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"url": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"size": 1
				},
				logo: {
					"image": {
						"alt": "",
						"src": "https://jbbjtodsvhsgjappwopg.supabase.co/storage/v1/object/public/sites/public-library/assets/logoipsum-261 (1).svg",
						"url": "https://jbbjtodsvhsgjappwopg.supabase.co/storage/v1/object/public/sites/public-library/assets/logoipsum-261 (1).svg",
						"size": 3
					},
					"title": "MORE HOMES CANADA"
				},
				site_nav: [
					{
						"link": { "url": "/#about", "label": "About Us" }
					},
					{
						"link": {
							"url": "/policy",
							"label": "Policy Document"
						}
					},
					{
						"link": { "url": "/#contact", "label": "Contact" }
					}
				]
			}
		});

	component_2 = new Component$3({
			props: {
				title: "More Homes Canada",
				favicon: {
					"alt": "house favicon",
					"src": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"url": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"size": 1
				},
				heading: "Background",
				items: [
					{
						"title": "Canada's housing shortage is a leading cause of our affordability crisis.",
						"description": {
							"html": "<ul>\n<li><p>Housing starts in Canada <a href=\"https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3410012601\">peaked in the 1970s</a>, even though our population has doubled since then.</p></li>\n<li><p>The rental vacancy rate across the country is at <a href=\"https://www.cmhc-schl.gc.ca/-/media/sites/cmhc/professional/housing-markets-data-and-research/market-reports/rental-market-report/rental-market-report-2022-en.ashx#:~:text=%E2%80%9CNational%20rental%20market%20conditions%20tightened,demand%20surging%20in%20many%20markets.%E2%80%9D&text=Growth%20in%20demand%20outpaced%20strong,rate's%20lowest%20level%20since%202001.\">a record low of 1.9%</a>—dropping even lower in the most expensive cities.</p></li>\n<li><p>Low vacancy rates <a href=\"https://doodles.mountainmath.ca/blog/2018/11/28/vacancy-rate-and-rent-change/\">drive large rent increases</a>. When vacancy rates are high, rent hikes slow down or even reverse.</p></li>\n<li><p>There is <a href=\"https://doodles.mountainmath.ca/blog/2019/08/19/running-on-empties/\">no massive secret supply of vacant homes</a>. In fact, Canada has <a href=\"https://businesscouncilab.com/insights-category/economic-insights/weekly-econ-minute-canada-housing-shortage/#:~:text=In%20fact%2C%20Canada%20has%20the,480%20dwellings%20per%201%2C000%20residents\">the fewest homes per person</a> in the entire G7.</p></li>\n</ul>",
							"markdown": "- Housing starts in Canada [peaked in the 1970s](<https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3410012601>), even though our population has doubled since then.\n\n- The rental vacancy rate across the country is at [a record low of 1.9%](<https://www.cmhc-schl.gc.ca/-/media/sites/cmhc/professional/housing-markets-data-and-research/market-reports/rental-market-report/rental-market-report-2022-en.ashx#:~:text=%E2%80%9CNational%20rental%20market%20conditions%20tightened,demand%20surging%20in%20many%20markets.%E2%80%9D&text=Growth%20in%20demand%20outpaced%20strong,rate's%20lowest%20level%20since%202001.>)—dropping even lower in the most expensive cities.\n\n- Low vacancy rates [drive large rent increases](<https://doodles.mountainmath.ca/blog/2018/11/28/vacancy-rate-and-rent-change/>). When vacancy rates are high, rent hikes slow down or even reverse.\n\n- There is [no massive secret supply of vacant homes](<https://doodles.mountainmath.ca/blog/2019/08/19/running-on-empties/>). In fact, Canada has [the fewest homes per person](https://businesscouncilab.com/insights-category/economic-insights/weekly-econ-minute-canada-housing-shortage/#:~:text=In%20fact%2C%20Canada%20has%20the,480%20dwellings%20per%201%2C000%20residents) in the entire G7."
						}
					},
					{
						"title": "Municipal regulations have strangled Canada’s housing supply.",
						"description": {
							"html": "<ul>\n<li><p>Zoning rules <a href=\"https://www.datalabto.ca/a-visual-guide-to-detached-houses-in-5-canadian-cities/\">prohibit high density housing on the majority of residential land</a>, even in cities with acute housing shortages.</p></li>\n<li><p>Most apartments require a rezoning, an expensive and risky process that requires a public hearing and vote at City Council.</p></li>\n<li><p>Floor space maximums and setback requirements greatly reduce the amount of housing that can be built on a given plot of land.</p></li>\n<li><p>Parking minimums add significant expense to new housing, with <a href=\"https://canadianrealestatemagazine.ca/news/greenlighting-new-toronto-parking-space-requirement-policy-was-right-move/\">each underground stall adding upwards of $100k to construction costs</a>.</p></li>\n<li><p>Development charges have ballooned far beyond reasonable levels, adding as much as <a href=\"https://ir.lib.uwo.ca/urbancentre-reports/8/\">$90k to home prices in the GTA</a>.</p></li>\n</ul>\n<!-- -->",
							"markdown": "- Zoning rules [prohibit high density housing on the majority of residential land](<https://www.datalabto.ca/a-visual-guide-to-detached-houses-in-5-canadian-cities/>), even in cities with acute housing shortages.\n\n- Most apartments require a rezoning, an expensive and risky process that requires a public hearing and vote at City Council.\n\n- Floor space maximums and setback requirements greatly reduce the amount of housing that can be built on a given plot of land.\n\n- Parking minimums add significant expense to new housing, with [each underground stall adding upwards of $100k to construction costs](https://canadianrealestatemagazine.ca/news/greenlighting-new-toronto-parking-space-requirement-policy-was-right-move/).\n\n- Development charges have ballooned far beyond reasonable levels, adding as much as [$90k to home prices in the GTA](<https://ir.lib.uwo.ca/urbancentre-reports/8/>).\n\n\n<!-- -->\n\n"
						}
					},
					{
						"title": "Building more market rate housing reduces housing costs and is crucial for broad affordability",
						"description": {
							"html": "<ul>\n<li><p>New housing, even if it's expensive, helps with affordability across the board by creating chains of vacancies throughout the housing market. People who move into \"luxury condos\" are reducing competition for more affordable homes elsewhere.</p></li>\n<li><p>Today’s new housing will form our future affordable housing stock. The affordable apartments we have today were expensive when they were first built.</p></li>\n<li><p>This is not trickle-down economics. Allowing more market housing does not cost municipalities anything—in fact, it generates revenue.</p></li>\n</ul>",
							"markdown": "* New housing, even if it's expensive, helps with affordability across the board by creating chains of vacancies throughout the housing market. People who move into \"luxury condos\" are reducing competition for more affordable homes elsewhere.\n\n* Today’s new housing will form our future affordable housing stock. The affordable apartments we have today were expensive when they were first built.\n\n* This is not trickle-down economics. Allowing more market housing does not cost municipalities anything—in fact, it generates revenue."
						}
					},
					{
						"title": "Urban sprawl is fiscally and environmentally unsustainable.",
						"description": {
							"html": "<ul>\n<li>Per capita emissions in low-density suburbs are <a href=\"https://res.cloudinary.com/dbnijop5c/image/upload/v1696959238/Toronto_carbon_footprints_charts_0_mrtv82.png\">up to 3 times higher than in urban areas</a></li>\n<li>Outward sprawl destroys irreplaceable natural habitats and farmland</li>\n<li>Apartment buildings are inherently much more energy efficient than low density homes</li>\n<li>New suburbs typically <a href=\"https://www.gtyeg.ca/finances\">cost much more to service than they generate in revenue.</a></li>\n</ul>",
							"markdown": "* Per capita emissions in low-density suburbs are [up to 3 times higher than in urban areas](https://res.cloudinary.com/dbnijop5c/image/upload/v1696959238/Toronto_carbon_footprints_charts_0_mrtv82.png)\n* Outward sprawl destroys irreplaceable natural habitats and farmland\n* Apartment buildings are inherently much more energy efficient than low density homes\n* New suburbs typically [cost much more to service than they generate in revenue.](https://www.gtyeg.ca/finances)\n\n"
						}
					}
				]
			}
		});

	component_3 = new Component$4({
			props: {
				title: "More Homes Canada",
				favicon: {
					"alt": "house favicon",
					"src": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"url": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"size": 1
				},
				heading: "Our Goals ",
				items: [
					{
						"title": "Row houses, multiplexes and low-rise apartments should be permitted in all neighbourhoods as-of-right.",
						"description": {
							"html": "<ul><li><p>\"Missing Middle\" housing projects are often killed by slow, expensive and risky rezoning processes.</p></li><li><p>Affordable housing projects are impacted the most and often face significant pushback at public hearings.</p></li><li><p>Auckland, NZ upzoned all residential land to allow middle-density housing in 2016. <a target=\"_blank\" rel=\"noopener noreferrer nofollow\" class=\"link link\" href=\"https://onefinaleffort.com/auckland\">Housing starts skyrocketed, and inflation-adjusted rents flatlined</a> (despite rising dramatically across the rest of the country).</p></li><li><p>In Auckland, roughly 21,000 extra homes (~4% of the entire housing supply) were built over just 5 years as a <a target=\"_blank\" rel=\"noopener noreferrer nofollow\" class=\"link link\" href=\"https://cdn.auckland.ac.nz/assets/business/about/our-research/research-institutes-and-centres/Economic-Policy-Centre--EPC-/006WP%20-%204.pdf\">direct result of the zoning changes</a>.</p></li></ul>",
							"markdown": "- \"Missing Middle\" housing projects are often killed by slow, expensive and risky rezoning processes.\n\n- Affordable housing projects are impacted the most and often face significant pushback at public hearings.\n\n- Auckland, NZ upzoned all residential land to allow middle-density housing in 2016. [Housing starts skyrocketed, and inflation-adjusted rents flatlined](<https://onefinaleffort.com/auckland>) (despite rising dramatically across the rest of the country).\n\n- In Auckland, roughly 21,000 extra homes (\\~4% of the entire housing supply) were built over just 5 years as a [direct result of the zoning changes](<https://cdn.auckland.ac.nz/assets/business/about/our-research/research-institutes-and-centres/Economic-Policy-Centre--EPC-/006WP%20-%204.pdf>).\n\n\n<!-- -->\n\n"
						}
					},
					{
						"title": "Mid-rise and high-rise apartments should be permitted as-of-right within walking distance of frequent transit and major job centres.",
						"description": {
							"html": "<ul>\n<li><p>Long and expensive rezoning processes inflate land costs and can cause significant delays for new housing projects.</p></li>\n<li><p>It is unjust to restrict multifamily housing to land adjacent to major roads with poor air quality and harmful levels of noise pollution.</p></li>\n<li><p><a href=\"https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3149272\">A 2016 study in Sydney</a> found that zoning restrictions increased the marginal cost of supplying units in high-rise buildings by a whopping 85%.</p></li>\n</ul>",
							"markdown": "* Long and expensive rezoning processes inflate land costs and can cause significant delays for new housing projects.\n\n* It is unjust to restrict multifamily housing to land adjacent to major roads with poor air quality and harmful levels of noise pollution.\n\n* [A 2016 study in Sydney](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3149272) found that zoning restrictions increased the marginal cost of supplying units in high-rise buildings by a whopping 85%."
						}
					},
					{
						"title": "Restrictions on setbacks, floorplate need to be relaxed and parking minimums abolished.",
						"description": {
							"html": "<ul>\n<li><p>Even when apartments are technically permitted, municipalities employ a suite of “poison pills” that make them far more expensive to build than they need to be.</p></li>\n<li><p>Parking minimums add significant expense to new housing, as each underground stall adding can <a href=\"https://canadianrealestatemagazine.ca/news/greenlighting-new-toronto-parking-space-requirement-policy-was-right-move/\">add upwards of $100k to construction costs</a>.</p></li>\n<li><p>Overzealous setbacks, floor space maximums and angular plane requirements substantially reduce the number of homes that can be built. They also result in inefficient and awkward layouts, prioritizing aesthetic preferences over the quality of life of future residents.</p></li>\n</ul>\n<!-- -->",
							"markdown": "- Even when apartments are technically permitted, municipalities employ a suite of “poison pills” that make them far more expensive to build than they need to be.\n\n- Parking minimums add significant expense to new housing, as each underground stall adding can [add upwards of $100k to construction costs](https://canadianrealestatemagazine.ca/news/greenlighting-new-toronto-parking-space-requirement-policy-was-right-move/).\n\n- Overzealous setbacks, floor space maximums and angular plane requirements substantially reduce the number of homes that can be built. They also result in inefficient and awkward layouts, prioritizing aesthetic preferences over the quality of life of future residents.\n\n\n<!-- -->\n\n"
						}
					},
					{
						"title": "Municipalities should not charge onerous fees on new high-density housing.",
						"description": {
							"html": "<ul>\n<li><p>Charging high fees on new homes <a href=\"https://ir.lib.uwo.ca/urbancentre-reports/8/\">reduces home construction and increases housing costs</a>.</p></li>\n<li><p>New high-density housing generates far more tax revenue than<a href=\"https://lede-admin.usa.streetsblog.org/wp-content/uploads/sites/46/2015/03/sprawlurban.jpg\"> it costs to service in the long run</a>. As such, it is not reasonable or fair to make new residents pay for increased public infrastructure and services up-front when they will be paying full property taxes thereafter.</p></li>\n<li><p>Fees should be consistent and predictable, both between similar projects within a specific city but also across cities within a province.</p></li>\n<li><p>Development fees should not be used to avoid property tax increases.</p></li>\n</ul>\n<!-- -->",
							"markdown": "- Charging high fees on new homes [reduces home construction and increases housing costs](https://ir.lib.uwo.ca/urbancentre-reports/8/).\n\n- New high-density housing generates far more tax revenue than[ it costs to service in the long run](<https://lede-admin.usa.streetsblog.org/wp-content/uploads/sites/46/2015/03/sprawlurban.jpg>). As such, it is not reasonable or fair to make new residents pay for increased public infrastructure and services up-front when they will be paying full property taxes thereafter.\n\n- Fees should be consistent and predictable, both between similar projects within a specific city but also across cities within a province.\n\n- Development fees should not be used to avoid property tax increases.\n\n\n<!-- -->\n\n"
						}
					},
					{
						"title": "Higher orders of government need to step in and intervene as municipalities are not making necessary reforms in a timely manner.",
						"description": {
							"html": "<ul>\n<li><p>Federal and provincial governments must set adequate targets for adding net new housing and divide these targets among municipalities.</p></li>\n<li><p>Incentive programs and/or penalties should be used to hold municipalities accountable to these targets.</p></li>\n<li><p>Provincial governments should not be afraid to make unilateral changes to land use regulations—<a href=\"https://news.gov.bc.ca/releases/2023HOUS0063-001748\">like Bill 47 in BC</a>. </p></li>\n</ul>",
							"markdown": "* Federal and provincial governments must set adequate targets for adding net new housing and divide these targets among municipalities.\n\n* Incentive programs and/or penalties should be used to hold municipalities accountable to these targets.\n\n* Provincial governments should not be afraid to make unilateral changes to land use regulations—[like Bill 47 in BC](https://news.gov.bc.ca/releases/2023HOUS0063-001748). "
						}
					},
					{
						"title": "We need more deeply affordable housing, but to achieve sufficient scale requires funding from provincial and federal governments. ",
						"description": {
							"html": "<p>It is unlikely that the private market will provide adequate housing for all needs, even with (realistic) subsidies. </p>\n<p>Housing is becoming unaffordable even for professionals making median salaries. Building subsidized housing for middle income earners is not scalable and will most likely function as a lottery for a few lucky winners.</p>\n<p>The need for social housing does not arise from building market-rate housing; it is a societal responsibility and should be paid for from general revenues, not pushed onto newcomers and the young.</p>",
							"markdown": "It is unlikely that the private market will provide adequate housing for all needs, even with (realistic) subsidies. \n\nHousing is becoming unaffordable even for professionals making median salaries. Building subsidized housing for middle income earners is not scalable and will most likely function as a lottery for a few lucky winners.\n\nThe need for social housing does not arise from building market-rate housing; it is a societal responsibility and should be paid for from general revenues, not pushed onto newcomers and the young."
						}
					},
					{
						"title": "Reform public consultation. ",
						"description": {
							"html": "<p>Aim for strong, clear rules to reduce the need for long negotiations about individual sites and arbitrary decision-making. </p>\n<p>The vast majority of consultation should be part of proactive community planning. Resulting community plans should provide clear, reliable requirements for anyone who wants to build, with no arbitrary decision-making and as few discretionary parameters as possible. </p>\n<p>The consultation process should be additive, with less focus on density and more on quality placemaking, services and infrastructure. Where consultation is needed, governments should assess demographics and adjust methods to ensure that the voices being heard represent the whole community and future residents.</p>",
							"markdown": "Aim for strong, clear rules to reduce the need for long negotiations about individual sites and arbitrary decision-making. \n\nThe vast majority of consultation should be part of proactive community planning. Resulting community plans should provide clear, reliable requirements for anyone who wants to build, with no arbitrary decision-making and as few discretionary parameters as possible. \n\nThe consultation process should be additive, with less focus on density and more on quality placemaking, services and infrastructure. Where consultation is needed, governments should assess demographics and adjust methods to ensure that the voices being heard represent the whole community and future residents."
						}
					}
				]
			}
		});

	component_4 = new Component$5({
			props: {
				title: "More Homes Canada",
				favicon: {
					"alt": "house favicon",
					"src": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"url": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"size": 1
				},
				heading: "Who We Are",
				subheading: "More Homes Canada is a coalition of housing advocacy groups from across the country. Together, we are fighting to end Canada’s housing shortage.",
				orgs: [
					{
						"link": "https://www.moreneighbours.ca/",
						"name": "More Neighbours Toronto",
						"image": {
							"alt": "",
							"url": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700527328/mnto_vaize2.png"
						},
						"social_links": []
					},
					{
						"link": "https://www.abundanthousingvancouver.com/",
						"name": "Abundant Housing Vancouver",
						"image": {
							"alt": "",
							"src": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528184/More%20Homes%20Canada/vancouver_sjf85y.jpg",
							"url": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528184/More%20Homes%20Canada/vancouver_sjf85y.jpg",
							"size": null
						},
						"social_links": []
					},
					{
						"link": "https://www.growtogetheryeg.com/",
						"name": "Grow Together Edmonton",
						"image": {
							"alt": "",
							"src": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528186/More%20Homes%20Canada/edmonton_x53wtv.png",
							"url": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528186/More%20Homes%20Canada/edmonton_x53wtv.png",
							"size": null
						},
						"social_links": []
					},
					{
						"link": "https://construisonsmtl.ca/en/",
						"name": "Construisons Montréal",
						"image": {
							"alt": "",
							"src": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528186/More%20Homes%20Canada/montreal_ejn4pg.png",
							"url": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528186/More%20Homes%20Canada/montreal_ejn4pg.png",
							"size": null
						},
						"social_links": []
					},
					{
						"link": "https://www.moreneighbourscalgary.ca/",
						"name": "More Neighbours Calgary",
						"image": {
							"alt": "",
							"src": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528186/More%20Homes%20Canada/calgary_b9krf6.png",
							"url": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528186/More%20Homes%20Canada/calgary_b9krf6.png",
							"size": null
						},
						"social_links": []
					},
					{
						"link": "https://www.homesforliving.ca/",
						"name": "Homes for Living Victoria",
						"image": {
							"alt": "",
							"src": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528184/More%20Homes%20Canada/victoria_n879ey.png",
							"url": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528184/More%20Homes%20Canada/victoria_n879ey.png",
							"size": null
						},
						"social_links": []
					},
					{
						"link": "https://makehousingaffordable.ca/",
						"name": "Make Housing Affordable Ottawa",
						"image": {
							"alt": "",
							"src": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528183/More%20Homes%20Canada/ottawa_civxsq.png",
							"url": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528183/More%20Homes%20Canada/ottawa_civxsq.png",
							"size": null
						},
						"social_links": []
					},
					{
						"link": "https://www.wryimby.com/",
						"name": "Waterloo Region YIMBY",
						"image": {
							"alt": "",
							"src": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528185/More%20Homes%20Canada/waterloo_llha5v.jpg",
							"url": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528185/More%20Homes%20Canada/waterloo_llha5v.jpg",
							"size": null
						},
						"social_links": []
					},
					{
						"link": "https://twitter.com/MoreHomesHRM",
						"name": "More Homes Halifax",
						"image": {
							"alt": "",
							"url": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528187/More%20Homes%20Canada/halifax_epvtfq.jpg"
						},
						"social_links": []
					},
					{
						"link": "https://www.yesinwpg.com/",
						"name": "YIMBY Winnipeg",
						"image": {
							"alt": "",
							"src": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528184/More%20Homes%20Canada/winnipeg_uvkpdu.png",
							"url": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528184/More%20Homes%20Canada/winnipeg_uvkpdu.png",
							"size": null
						},
						"social_links": []
					},
					{
						"link": "https://twitter.com/MoreHomesSauga",
						"name": "More Homes Mississauga",
						"image": {
							"alt": "",
							"src": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1702327165142mhm.jpg",
							"url": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1702327165142mhm.jpg",
							"size": 16
						},
						"social_links": []
					},
					{
						"link": "https://www.beautifulnanaimo.ca/",
						"name": "Strong Towns Nanaimo",
						"image": {
							"alt": "",
							"src": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528183/More%20Homes%20Canada/nanaimo_dnm0vl.png",
							"url": "https://res.cloudinary.com/dbnijop5c/image/upload/v1700528183/More%20Homes%20Canada/nanaimo_dnm0vl.png",
							"size": null
						},
						"social_links": []
					},
					{
						"link": "https://www.strongtownslangley.org/",
						"name": "Strong Towns Langley",
						"image": {
							"alt": "",
							"src": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1702261260112download%20(1).png",
							"url": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1702261260112download%20(1).png",
							"size": 7
						},
						"social_links": [
							{
								"icon": "Tempor deserunt deserunt",
								"link": { "url": "/", "label": "reprehenderit" }
							}
						]
					}
				]
			}
		});

	component_5 = new Component$6({
			props: {
				title: "More Homes Canada",
				favicon: {
					"alt": "house favicon",
					"src": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"url": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"size": 1
				},
				nav: [
					{
						"link": { "url": "/", "label": "More Homes Canada" }
					}
				],
				social: [
					{
						"icon": "mdi:twitter",
						"link": {
							"url": "https://twitter.com/MoreHomesCanada",
							"label": "Twitter"
						}
					},
					{
						"icon": "mdi:instagram",
						"link": {
							"url": "https://www.instagram.com/morehomescanada/",
							"label": "Instagram"
						}
					}
				]
			}
		});

	component_6 = new Component$7({
			props: {
				title: "More Homes Canada",
				favicon: {
					"alt": "house favicon",
					"src": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"url": "https://dpfecbhwrshlsbfgbgzq.supabase.co/storage/v1/object/public/images/7c7fa9c9-29db-4592-99b1-971042386623/1701390612420favicon-32x32.png",
					"size": 1
				}
			}
		});

	return {
		c() {
			create_component(component_0.$$.fragment);
			t0 = space();
			create_component(component_1.$$.fragment);
			t1 = space();
			create_component(component_2.$$.fragment);
			t2 = space();
			create_component(component_3.$$.fragment);
			t3 = space();
			create_component(component_4.$$.fragment);
			t4 = space();
			create_component(component_5.$$.fragment);
			t5 = space();
			create_component(component_6.$$.fragment);
		},
		l(nodes) {
			claim_component(component_0.$$.fragment, nodes);
			t0 = claim_space(nodes);
			claim_component(component_1.$$.fragment, nodes);
			t1 = claim_space(nodes);
			claim_component(component_2.$$.fragment, nodes);
			t2 = claim_space(nodes);
			claim_component(component_3.$$.fragment, nodes);
			t3 = claim_space(nodes);
			claim_component(component_4.$$.fragment, nodes);
			t4 = claim_space(nodes);
			claim_component(component_5.$$.fragment, nodes);
			t5 = claim_space(nodes);
			claim_component(component_6.$$.fragment, nodes);
		},
		m(target, anchor) {
			mount_component(component_0, target, anchor);
			insert_hydration(target, t0, anchor);
			mount_component(component_1, target, anchor);
			insert_hydration(target, t1, anchor);
			mount_component(component_2, target, anchor);
			insert_hydration(target, t2, anchor);
			mount_component(component_3, target, anchor);
			insert_hydration(target, t3, anchor);
			mount_component(component_4, target, anchor);
			insert_hydration(target, t4, anchor);
			mount_component(component_5, target, anchor);
			insert_hydration(target, t5, anchor);
			mount_component(component_6, target, anchor);
			current = true;
		},
		p: noop,
		i(local) {
			if (current) return;
			transition_in(component_0.$$.fragment, local);
			transition_in(component_1.$$.fragment, local);
			transition_in(component_2.$$.fragment, local);
			transition_in(component_3.$$.fragment, local);
			transition_in(component_4.$$.fragment, local);
			transition_in(component_5.$$.fragment, local);
			transition_in(component_6.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(component_0.$$.fragment, local);
			transition_out(component_1.$$.fragment, local);
			transition_out(component_2.$$.fragment, local);
			transition_out(component_3.$$.fragment, local);
			transition_out(component_4.$$.fragment, local);
			transition_out(component_5.$$.fragment, local);
			transition_out(component_6.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			destroy_component(component_0, detaching);
			if (detaching) detach(t0);
			destroy_component(component_1, detaching);
			if (detaching) detach(t1);
			destroy_component(component_2, detaching);
			if (detaching) detach(t2);
			destroy_component(component_3, detaching);
			if (detaching) detach(t3);
			destroy_component(component_4, detaching);
			if (detaching) detach(t4);
			destroy_component(component_5, detaching);
			if (detaching) detach(t5);
			destroy_component(component_6, detaching);
		}
	};
}

class Component$8 extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, null, create_fragment$7, safe_not_equal, {});
	}
}

export default Component$8;
