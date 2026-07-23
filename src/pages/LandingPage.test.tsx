import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LandingPage from './LandingPage';

// Mock AuthModal so we don't pull its full dependency tree (lucide-react, etc.)
vi.mock('../components/AuthModal', () => ({
  default: () => <div data-testid="auth-modal">AuthModal</div>,
}));

// jsdom does not implement scrollIntoView - stub it so anchors do not throw
beforeEach(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {
      /* noop for jsdom */
    };
  }
});

describe('LandingPage - mobile hamburger navigation', () => {
  it('renders a hamburger button with accessible label below md', () => {
    render(<LandingPage />);
    const hamburger = screen.getByRole('button', { name: /open menu/i });
    expect(hamburger).toBeInTheDocument();
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    expect(hamburger).toHaveAttribute('aria-controls', 'mobile-nav-drawer');
  });

  it('opens the drawer with Features / Pricing / Reviews / Sign In when hamburger is clicked', () => {
    render(<LandingPage />);
    const hamburger = screen.getByRole('button', { name: /open menu/i });
    fireEvent.click(hamburger);

    // Drawer should now be present and announce expanded
    expect(hamburger).toHaveAttribute('aria-expanded', 'true');

    // Drawer content links
    const drawer = screen.getByRole('dialog', { name: /mobile navigation/i });
    expect(drawer).toBeInTheDocument();

    // Each link must be present at least once inside the drawer
    const features = drawer.querySelector('a[href="#features"]');
    const pricing = drawer.querySelector('a[href="#pricing"]');
    const reviews = drawer.querySelector('a[href="#testimonials"]');
    expect(features).toBeTruthy();
    expect(pricing).toBeTruthy();
    expect(reviews).toBeTruthy();
  });

  it('hamburger tap target is at least 44x44 px (Apple/Google minimum)', () => {
    render(<LandingPage />);
    const hamburger = screen.getByRole('button', { name: /open menu/i });
    expect(hamburger.className).toMatch(/min-h-\[44px\]/);
    expect(hamburger.className).toMatch(/min-w-\[44px\]/);
  });

  it('drawer menu links have min-height 44px tap targets', () => {
    render(<LandingPage />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    const drawer = screen.getByRole('dialog', { name: /mobile navigation/i });
    const anchors = drawer.querySelectorAll('a, button');
    anchors.forEach((el) => {
      expect(el.className).toMatch(/min-h-\[44px\]/);
    });
  });

  it('toggles the hamburger icon between Menu and X when opened', () => {
    render(<LandingPage />);
    const hamburger = screen.getByRole('button', { name: /open menu/i });
    // After click, the button label flips to "Close menu"
    fireEvent.click(hamburger);
    const closeBtn = screen.getByRole('button', { name: /close menu/i });
    expect(closeBtn).toHaveAttribute('aria-expanded', 'true');
  });
});
