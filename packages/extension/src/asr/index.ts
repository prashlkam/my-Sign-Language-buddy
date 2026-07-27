import type { AsrCallbacks, AsrEngine } from './engine';
import { WebSpeechEngine, isWebSpeechAvailable } from './web-speech';
import { HelperEngine } from './helper';
import type { AsrEngine as EngineChoice } from '../settings';

export * from './engine';
export { WebSpeechEngine, isWebSpeechAvailable, HelperEngine };

export function createAsrEngine(
  choice: EngineChoice,
  cb: AsrCallbacks,
  language: string | null,
): AsrEngine | null {
  switch (choice) {
    case 'off':
      return null;
    case 'helper':
      return new HelperEngine(cb);
    case 'web-speech':
      return isWebSpeechAvailable() ? new WebSpeechEngine(cb, language) : null;
    default:
      return null;
  }
}
