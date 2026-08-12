import React from 'react';

export const LiquidGlassSvgFilter: React.FC = () => {
  return (
    <svg
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
      colorInterpolationFilters="sRGB"
    >
      <defs>
        {/* SVG Displacement Map Refraction Filter as described in kube.io Liquid Glass specification */}
        <filter id="liquid-glass-refraction" x="0%" y="0%" width="100%" height="100%">
          {/* 1. Generate subtle liquid fluid turbulence vector map */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012"
            numOctaves="2"
            seed="42"
            result="liquid_noise"
          />
          {/* 2. Refract background graphics smoothly without edge displacement artifacts */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="liquid_noise"
            scale="6"
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced_graphic"
          />
          {/* 3. Elevate color saturation on refracted glass edges */}
          <feColorMatrix
            in="displaced_graphic"
            type="saturate"
            values="1.8"
            result="saturated_graphic"
          />
          {/* 4. Smooth out optical dispersion blur */}
          <feGaussianBlur
            in="saturated_graphic"
            stdDeviation="0.4"
            result="blurred_graphic"
          />
          {/* 5. Blend specular lighting over refracted image */}
          <feBlend
            in="SourceGraphic"
            in2="blurred_graphic"
            mode="overlay"
          />
        </filter>
      </defs>
    </svg>
  );
};
