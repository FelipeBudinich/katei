import { Controller } from '../../vendor/stimulus/stimulus.js';
import { closeSheetDialog, openSheetDialog } from './sheet_dialog.js';

export default class extends Controller {
  static targets = ['trigger', 'menu', 'select', 'option', 'dialog'];

  isDialogMode() {
    return this.hasDialogTarget;
  }

  toggleMenu(event) {
    event.preventDefault();

    if (this.isDialogMode()) {
      this.openDialog(event);
      return;
    }

    if (this.menuTarget.hidden) {
      this.openMenu();
      return;
    }

    this.closeMenu();
  }

  openMenu() {
    if (this.isDialogMode()) {
      this.openDialog();
      return;
    }

    if (!this.hasTriggerTarget || !this.hasMenuTarget || !this.hasOptionTarget || this.optionTargets.length < 1) {
      return;
    }

    if (this.triggerTarget.disabled === true) {
      return;
    }

    this.menuTarget.hidden = false;
    this.triggerTarget.setAttribute('aria-expanded', 'true');
  }

  closeMenu({ restoreFocus = false } = {}) {
    if (this.hasMenuTarget) {
      this.menuTarget.hidden = true;
    }

    if (this.hasTriggerTarget) {
      this.triggerTarget.setAttribute('aria-expanded', 'false');

      if (restoreFocus) {
        this.triggerTarget.focus?.();
      }
    }
  }

  openDialog(event) {
    event?.preventDefault?.();

    if (!this.isDialogMode() || !this.hasTriggerTarget || !this.hasDialogTarget) {
      return;
    }

    if (this.triggerTarget.disabled === true) {
      return;
    }

    openSheetDialog(this.dialogTarget);

    this.triggerTarget.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => this.focusSelectedOption());
  }

  closeDialog(event, { restoreFocus = true } = {}) {
    if (event) {
      event.preventDefault();
    }

    if (this.hasDialogTarget) {
      closeSheetDialog(this.dialogTarget);
    }

    if (this.hasTriggerTarget) {
      this.triggerTarget.setAttribute('aria-expanded', 'false');

      if (restoreFocus) {
        this.triggerTarget.focus?.();
      }
    }
  }

  handleTriggerKeydown(event) {
    if (this.isDialogMode()) {
      if (
        event.key === 'Enter'
        || event.key === ' '
        || event.key === 'Spacebar'
        || event.key === 'ArrowDown'
        || event.key === 'ArrowUp'
      ) {
        event.preventDefault();
        this.openDialog();
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.openMenu();
      this.focusSelectedOption();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.openMenu();
      this.focusSelectedOption();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.openMenu();
      this.focusSelectedOption();
    }
  }

  handleMenuKeydown(event) {
    const options = this.optionTargets;

    if (options.length < 1) {
      return;
    }

    const activeIndex = options.findIndex((option) => option === event.target);

    if (event.key === 'Escape') {
      if (this.isDialogMode()) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      this.closeMenu({ restoreFocus: true });
      return;
    }

    if (event.key === 'Tab') {
      if (this.isDialogMode()) {
        return;
      }

      this.closeMenu();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusOptionByIndex(activeIndex >= 0 ? activeIndex + 1 : 0);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.focusOptionByIndex(activeIndex >= 0 ? activeIndex - 1 : options.length - 1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      this.focusOptionByIndex(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      this.focusOptionByIndex(options.length - 1);
    }
  }

  selectLocale(event) {
    event.preventDefault();

    const selectedOption = event.currentTarget;
    const locale = selectedOption?.dataset?.locale ?? '';

    if (!locale || !this.hasSelectTarget) {
      return;
    }

    this.selectTarget.value = locale;

    for (const option of this.optionTargets) {
      const isSelected = option.dataset.locale === locale;
      option.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    }

    if (this.isDialogMode()) {
      this.closeDialog(undefined, { restoreFocus: false });
    } else {
      this.closeMenu({ restoreFocus: false });
    }

    if (typeof this.element.requestSubmit === 'function') {
      this.element.requestSubmit();
      return;
    }

    this.element.submit();
  }

  handleWindowClick(event) {
    if (this.isDialogMode()) {
      return;
    }

    if (this.menuTarget.hidden) {
      return;
    }

    const target = event?.target ?? null;

    if (this.element.contains?.(target)) {
      return;
    }

    this.closeMenu();
  }

  focusSelectedOption() {
    const selectedIndex = this.optionTargets.findIndex((option) => option.getAttribute('aria-checked') === 'true');
    this.focusOptionByIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }

  focusOptionByIndex(index) {
    const options = this.optionTargets;

    if (options.length < 1) {
      return;
    }

    const boundedIndex = ((index % options.length) + options.length) % options.length;
    options[boundedIndex]?.focus?.();
  }
}
