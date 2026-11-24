export type Child = Node | string | number | false | null | undefined | Child[];

function appendChild(el: Element, child: Child) {
  if (child === false || child === null || child === undefined) return;
  if (Array.isArray(child)) {
    child.forEach((c) => appendChild(el, c));
    return;
  }
  el.append(child instanceof Node ? child : document.createTextNode(String(child)));
}

export interface ElOptions {
  class?: string;
  id?: string;
  type?: string;
  value?: string | number;
  method?: string;
  text?: string;
  html?: string;
  hidden?: boolean;
  attrs?: Record<string, string | number | boolean | undefined>;
  props?: Record<string, unknown>;
  on?: Record<string, EventListenerOrEventListenerObject>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options.class) el.className = options.class;
  if (options.id) el.id = options.id;
  if (options.type) el.setAttribute('type', options.type);
  if (options.method) el.setAttribute('method', options.method);
  if (options.value !== undefined) el.setAttribute('value', String(options.value));
  if (options.hidden) el.hidden = true;
  if (options.text !== undefined) el.textContent = options.text;
  if (options.html !== undefined) el.innerHTML = options.html;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === undefined || value === false) continue;
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (options.props) {
    Object.assign(el, options.props);
  }
  if (options.on) {
    for (const [event, handler] of Object.entries(options.on)) {
      el.addEventListener(event, handler);
    }
  }
  children.forEach((child) => appendChild(el, child));
  return el;
}

export function clear(el: HTMLElement) {
  el.replaceChildren();
}

export function mount(el: HTMLElement, node: Node) {
  clear(el);
  el.append(node);
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLLabelElement {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    input,
    hint ? h('small', { class: 'field-hint', text: hint }) : null,
  );
}

export function textInput(value: string, opts: {
  type?: string;
  step?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  oninput?: (value: string) => void;
} = {}): HTMLInputElement {
  return h('input', {
    props: { value, type: opts.type ?? 'text', step: opts.step, min: opts.min, max: opts.max, placeholder: opts.placeholder },
    on: opts.oninput ? { input: ((e: Event) => opts.oninput!((e.target as HTMLInputElement).value)) as EventListener } : undefined,
  });
}

export function selectInput<T extends string>(
  value: T,
  options: Array<{ value: T; label: string }>,
  onchange?: (value: T) => void,
): HTMLSelectElement {
  return h('select', {
    on: onchange
      ? { change: ((e: Event) => onchange((e.target as HTMLSelectElement).value as T)) as EventListener }
      : undefined,
  }, ...options.map((o) => h('option', { props: { value: o.value, selected: o.value === value }, text: o.label })));
}

export function modal(title: string, content: HTMLElement, actions: HTMLElement[]): HTMLDialogElement {
  const dlg = h('dialog', { class: 'modal' },
    h('form', { method: 'dialog', class: 'modal-card' },
      h('header', { class: 'modal-head' },
        h('h2', { text: title }),
        h('button', { class: 'icon-btn', attrs: { value: 'cancel', 'aria-label': '关闭' }, text: '✕' }),
      ),
      h('div', { class: 'modal-body' }, content),
      h('footer', { class: 'modal-foot' }, ...actions),
    ),
  ) as HTMLDialogElement;
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close('cancel');
  });
  return dlg;
}

export function confirmDialog(message: string): boolean {
  return window.confirm(message);
}
