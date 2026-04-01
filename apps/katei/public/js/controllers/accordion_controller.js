import { Controller } from '/vendor/stimulus/stimulus.js';
import {
  createAccordionItemStates,
  getAccordionNextOpenIndex,
  normalizeAccordionOpenIndex
} from './accordion_state.js';

const TRANSITION_DURATION_MS = 200;
const TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

export default class extends Controller {
  static targets = ['item', 'trigger', 'panel'];

  static values = {
    openIndex: { type: Number, default: 0 }
  };

  connect() {
    this.transitionHandlers = new WeakMap();
    this.openIndexValue = normalizeAccordionOpenIndex(this.openIndexValue, this.panelTargets.length);
    this.syncState({ animate: false });
  }

  disconnect() {
    for (const panel of this.panelTargets) {
      this.cancelPendingTransition(panel);
      this.clearPanelStyles(panel);
    }
  }

  reset() {
    if (this.panelTargets.length === 0) {
      return;
    }

    this.openIndexValue = 0;
    this.syncState({ animate: false });
  }

  toggle(event) {
    const index = this.triggerTargets.indexOf(event.currentTarget);

    if (index === -1) {
      return;
    }

    const nextOpenIndex = getAccordionNextOpenIndex({
      currentOpenIndex: this.openIndexValue,
      requestedIndex: index,
      itemCount: this.panelTargets.length
    });

    if (nextOpenIndex === this.openIndexValue) {
      return;
    }

    this.openIndexValue = nextOpenIndex;
    this.syncState();
  }

  syncState({ animate = true } = {}) {
    const itemStates = createAccordionItemStates({
      itemCount: this.panelTargets.length,
      openIndex: this.openIndexValue
    });

    if (itemStates.length === 0) {
      return;
    }

    this.openIndexValue = itemStates.find((itemState) => itemState.isOpen)?.index ?? 0;

    itemStates.forEach(({ index, isOpen, ariaExpanded }) => {
      const item = this.itemTargets[index];
      const trigger = this.triggerTargets[index];
      const panel = this.panelTargets[index];

      item?.classList.toggle('is-open', isOpen);
      trigger?.setAttribute('aria-expanded', ariaExpanded);
      this.syncChevron(trigger, isOpen);

      if (isOpen) {
        if (animate) {
          this.expand(panel);
        } else {
          this.showPanel(panel);
        }

        return;
      }

      if (animate) {
        this.collapse(panel);
      } else {
        this.hidePanel(panel);
      }
    });
  }

  expand(panel) {
    if (!panel) {
      return;
    }

    if (this.prefersReducedMotion) {
      this.showPanel(panel);
      return;
    }

    this.cancelPendingTransition(panel);
    panel.hidden = false;
    panel.style.overflow = 'hidden';
    panel.style.height = '0px';
    panel.style.opacity = '0';
    panel.style.transition = this.transitionStyle;
    panel.getBoundingClientRect();

    requestAnimationFrame(() => {
      panel.style.height = `${panel.scrollHeight}px`;
      panel.style.opacity = '1';
    });

    this.registerTransitionCleanup(panel, () => {
      panel.hidden = false;
      this.clearPanelStyles(panel);
    });
  }

  collapse(panel) {
    if (!panel) {
      return;
    }

    if (this.prefersReducedMotion) {
      this.hidePanel(panel);
      return;
    }

    this.cancelPendingTransition(panel);

    if (panel.hidden) {
      this.hidePanel(panel);
      return;
    }

    panel.style.overflow = 'hidden';
    panel.style.height = `${panel.scrollHeight}px`;
    panel.style.opacity = '1';
    panel.style.transition = this.transitionStyle;
    panel.getBoundingClientRect();

    requestAnimationFrame(() => {
      panel.style.height = '0px';
      panel.style.opacity = '0';
    });

    this.registerTransitionCleanup(panel, () => {
      this.hidePanel(panel);
    });
  }

  showPanel(panel) {
    this.cancelPendingTransition(panel);
    panel.hidden = false;
    this.clearPanelStyles(panel);
  }

  hidePanel(panel) {
    this.cancelPendingTransition(panel);
    panel.hidden = true;
    this.clearPanelStyles(panel);
  }

  syncChevron(trigger, isOpen) {
    const chevron = trigger?.querySelector('[data-accordion-chevron]');

    if (!chevron) {
      return;
    }

    chevron.classList.toggle('rotate-180', isOpen);
  }

  registerTransitionCleanup(panel, callback) {
    const onTransitionEnd = (event) => {
      if (event.target !== panel || event.propertyName !== 'height') {
        return;
      }

      this.cancelPendingTransition(panel);
      callback();
    };
    const timeoutId = window.setTimeout(() => {
      this.cancelPendingTransition(panel);
      callback();
    }, TRANSITION_DURATION_MS + 50);

    this.transitionHandlers.set(panel, { onTransitionEnd, timeoutId });
    panel.addEventListener('transitionend', onTransitionEnd);
  }

  cancelPendingTransition(panel) {
    const handler = this.transitionHandlers.get(panel);

    if (!handler) {
      return;
    }

    panel.removeEventListener('transitionend', handler.onTransitionEnd);
    window.clearTimeout(handler.timeoutId);
    this.transitionHandlers.delete(panel);
  }

  clearPanelStyles(panel) {
    panel.style.height = '';
    panel.style.opacity = '';
    panel.style.overflow = '';
    panel.style.transition = '';
  }

  get transitionStyle() {
    return `height ${TRANSITION_DURATION_MS}ms ${TRANSITION_EASING}, opacity ${TRANSITION_DURATION_MS}ms ${TRANSITION_EASING}`;
  }

  get prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  }
}
