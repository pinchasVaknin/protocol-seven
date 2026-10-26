import { describe, expect, it, vi } from 'vitest';
import { characterDefinition } from './CharacterCatalog';
import type { CharacterAvatarFactory } from './CharacterAvatarFactory';
import { FactoryCharacterAvatarProvider } from './CharacterAvatarProvider';

/**
 * The renderer's narrow view of character assets, pinned before unit C5's refactor.
 *
 * One rule, and it is a containment rule: a clone that throws must not throw again on every
 * render frame, and it must not poison anything outside this Match. So the failure is latched
 * here and the service is left free to finish a retry for somebody else.
 */

const echo = characterDefinition('echo');

function factoryThat(behaviour: 'works' | 'throws'): CharacterAvatarFactory {
  return {
    create: () => {
      if (behaviour === 'throws') throw new Error('malformed clone');
      return { marker: true } as never;
    },
  } as unknown as CharacterAvatarFactory;
}

describe('FactoryCharacterAvatarProvider', () => {
  it('is not ready while the service has no factory yet', () => {
    const provider = new FactoryCharacterAvatarProvider(echo, () => null);
    expect(provider.isReady).toBe(false);
    expect(provider.create()).toBeNull();
  });

  it('becomes ready the moment the factory appears, without being replaced', () => {
    let factory: CharacterAvatarFactory | null = null;
    const provider = new FactoryCharacterAvatarProvider(echo, () => factory);
    expect(provider.isReady).toBe(false);
    factory = factoryThat('works');
    expect(provider.isReady).toBe(true);
    expect(provider.create()).not.toBeNull();
  });

  it('creates through the factory it is given each time', () => {
    const factory = factoryThat('works');
    const create = vi.spyOn(factory, 'create');
    const provider = new FactoryCharacterAvatarProvider(echo, () => factory);
    provider.create();
    provider.create();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('latches a clone failure instead of throwing in every frame', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const factory = factoryThat('throws');
    const create = vi.spyOn(factory, 'create');
    const provider = new FactoryCharacterAvatarProvider(echo, () => factory);

    expect(provider.create()).toBeNull();
    expect(provider.isReady).toBe(false);
    // Every later frame asks and is refused without reaching the factory again.
    expect(provider.create()).toBeNull();
    expect(provider.create()).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('says which character failed, so a retry has something to go on', () => {
    const messages: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => void messages.push(String(m)));
    const provider = new FactoryCharacterAvatarProvider(echo, () => factoryThat('throws'));
    provider.create();
    expect(messages.some((m) => m.includes(echo.id))).toBe(true);
    expect(messages.some((m) => m.includes('malformed clone'))).toBe(true);
    warn.mockRestore();
  });

  it('stops creating once the Match it belongs to is disposed', () => {
    const provider = new FactoryCharacterAvatarProvider(echo, () => factoryThat('works'));
    expect(provider.isReady).toBe(true);
    provider.dispose();
    expect(provider.isReady).toBe(false);
    expect(provider.create()).toBeNull();
  });

  it('keeps one Match’s failure out of another’s', () => {
    const factory = factoryThat('works');
    const broken = new FactoryCharacterAvatarProvider(echo, () => factoryThat('throws'));
    const healthy = new FactoryCharacterAvatarProvider(echo, () => factory);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    broken.create();
    expect(broken.isReady).toBe(false);
    // The service's factory is untouched, so a provider in another Match still works.
    expect(healthy.isReady).toBe(true);
    expect(healthy.create()).not.toBeNull();
    warn.mockRestore();
  });

  it('owns no GLB resource, so disposing it disposes nothing shared', () => {
    const factory = factoryThat('works');
    const dispose = vi.fn();
    (factory as unknown as { dispose: unknown }).dispose = dispose;
    const provider = new FactoryCharacterAvatarProvider(echo, () => factory);
    provider.dispose();
    expect(dispose).not.toHaveBeenCalled();
  });
});
