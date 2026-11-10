import { useId } from 'react';
import wordmark from '../assets/malera-wordmark.png';

export function MaleraMark() {
  const key = useId();
  return <svg className="malera-mark" viewBox="172 1760 3752 576" role="img" aria-label="Malera">
    <defs>
      {/* Recover the original edge coverage from green (249 over 4) in the source PNG. */}
      <filter id={key} colorInterpolationFilters="sRGB">
        <feColorMatrix values="0 0 0 0 .8666667
                               0 0 0 0 .9764706
                               0 0 0 0 .1058824
                               0 1.0408163 0 0 -.0163265"/>
      </filter>
    </defs>
    <image href={wordmark} width="4096" height="4096" filter={'url(#' + key + ')'}/>
  </svg>;
}
