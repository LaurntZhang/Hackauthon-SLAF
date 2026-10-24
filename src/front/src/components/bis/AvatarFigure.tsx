/*
 * Avatars « argile » dessinés en SVG : un même squelette (tête, oreilles, deux yeux, sourcils, nez, bouche)
 * décliné par la peau, la coiffure, les lunettes, la barbe, le casque et le vêtement.
 * Le dégradé radial sur la tête et le vêtement donne le volume.
 */
import { memo } from 'react';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

export type HairStyle = 'short' | 'quiff' | 'curly' | 'bun' | 'long' | 'bob' | 'bald';

export type Persona = {
  id: string;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  collar: 'crew' | 'shirt' | 'suit';
  glasses?: boolean;
  beard?: boolean;
  headset?: boolean;
};

/** Éclaircit (amt > 0) ou assombrit (amt < 0) une couleur #rrggbb. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const INK = '#1b1d26';

function BackHair({ p }: { p: Persona }) {
  const fill = `url(#${p.id}-hair)`;
  if (p.hairStyle === 'long') {
    return <Path d="M18 44C14 14 34 4 50 4s36 10 32 40l4 52c0 8-10 6-12-2l-2-34H28l-2 34c-2 8-12 10-12 2z" fill={fill} />;
  }
  if (p.hairStyle === 'bob') {
    return <Path d="M17 46C13 14 34 4 50 4s37 10 33 42l-1 22c0 5-10 5-10-2V56H28v12c0 7-10 7-10 2z" fill={fill} />;
  }
  return null;
}

function FrontHair({ p }: { p: Persona }) {
  const fill = `url(#${p.id}-hair)`;
  switch (p.hairStyle) {
    case 'short':
      return <Path d="M20.5 46C17 20 33 10 50 10s33 10 29.5 36C75 34 66 28 50 28S25 34 20.5 46z" fill={fill} />;
    case 'quiff':
      return (
        <>
          <Path d="M19 46C14 18 34 6 56 8c18 2 30 16 25 38-4-12-11-20-29-22-12 0-24 6-33 22z" fill={fill} />
          <Path d="M42 12C50 2 68 4 75 14c-10-3-18-2-25 6z" fill={fill} />
        </>
      );
    case 'curly':
      return (
        <>
          <Path d="M21 44C20 24 34 14 50 14s30 10 29 30C74 34 66 29 50 29S26 34 21 44z" fill={fill} />
          {[
            [27, 24, 10],
            [39, 16, 11],
            [52, 13, 11],
            [65, 16, 11],
            [76, 25, 10],
            [21, 37, 7],
            [79, 37, 7],
          ].map(([cx, cy, r]) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={fill} />
          ))}
        </>
      );
    case 'bun':
      return (
        <>
          <Circle cx="50" cy="9" r="9" fill={fill} />
          <Path d="M20.5 46C17 20 33 11 50 11s33 9 29.5 35C75 34 66 28 50 28S25 34 20.5 46z" fill={fill} />
        </>
      );
    case 'long':
    case 'bob':
      return <Path d="M20.5 46C16 20 32 9 52 10c18 1 32 12 27.5 36-2-8-7-15-13-20-14 8-32 8-44 20z" fill={fill} />;
    default:
      return null;
  }
}

function Collar({ p }: { p: Persona }) {
  const neck = shade(p.skin, -0.16);
  if (p.collar === 'crew') {
    return <Path d="M37 82Q50 99 63 82z" fill={neck} />;
  }
  return (
    <>
      <Path d="M42 82L50 97L58 82z" fill={neck} />
      <Path d="M35 81L50 100L41 101L30 88z" fill="#f4f6f8" />
      <Path d="M65 81L50 100L59 101L70 88z" fill="#f4f6f8" />
    </>
  );
}

function Tie({ accent }: { accent: string }) {
  return (
    <>
      <Path d="M47 89h6l-1 6h-4z" fill={accent} />
      <Path d="M48 95h4l2.5 17h-9z" fill={accent} />
    </>
  );
}

type Props = { persona: Persona; width: number; accent: string };

function AvatarFigureBase({ persona: p, width, accent }: Props) {
  const browColor = p.hairStyle === 'bald' ? INK : shade(p.hair, -0.25);
  const skinDeep = shade(p.skin, -0.14);
  return (
    <Svg width={width} height={width * 1.16} viewBox="0 -3 100 116">
      <Defs>
        <RadialGradient id={`${p.id}-skin`} cx="36%" cy="28%" r="85%">
          <Stop offset="0" stopColor={shade(p.skin, 0.22)} />
          <Stop offset="0.55" stopColor={p.skin} />
          <Stop offset="1" stopColor={shade(p.skin, -0.2)} />
        </RadialGradient>
        <LinearGradient id={`${p.id}-hair`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={shade(p.hair, 0.22)} />
          <Stop offset="1" stopColor={p.hair} />
        </LinearGradient>
        <LinearGradient id={`${p.id}-shirt`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={shade(p.shirt, 0.18)} />
          <Stop offset="1" stopColor={shade(p.shirt, -0.28)} />
        </LinearGradient>
      </Defs>

      <BackHair p={p} />

      <Path d="M4 112C4 90 26 82 50 82s46 8 46 30z" fill={`url(#${p.id}-shirt)`} />
      {p.collar === 'suit' ? <Path d="M38 81L28 112M62 81L72 112" stroke={shade(p.shirt, -0.4)} strokeWidth="2" /> : null}
      <Collar p={p} />
      {p.collar === 'suit' ? <Tie accent={accent} /> : null}

      <Path d="M41 62v21q9 7 18 0V62z" fill={skinDeep} />
      <Ellipse cx="50" cy="74" rx="13" ry="5" fill="#000" opacity="0.14" />

      <Ellipse cx="21.5" cy="47" rx="5.5" ry="8" fill={skinDeep} />
      <Ellipse cx="78.5" cy="47" rx="5.5" ry="8" fill={skinDeep} />
      <Ellipse cx="50" cy="44" rx="29" ry="31.5" fill={`url(#${p.id}-skin)`} />

      {p.beard ? <Path d="M21.5 50C21 70 33 78 50 78s29-8 28.5-28C76 60 69 70.5 50 70.5S24 60 21.5 50z" fill={`url(#${p.id}-hair)`} /> : null}

      <Circle cx="32" cy="57" r="5" fill="#ff6f6f" opacity="0.16" />
      <Circle cx="68" cy="57" r="5" fill="#ff6f6f" opacity="0.16" />

      <Path d="M31 37Q38 33.5 45 36.5M55 36.5Q62 33.5 69 37" stroke={browColor} strokeWidth="4.2" strokeLinecap="round" fill="none" />
      <Ellipse cx="39" cy="47" rx="3.4" ry="5" fill={INK} />
      <Ellipse cx="61" cy="47" rx="3.4" ry="5" fill={INK} />
      <Circle cx="40.2" cy="44.8" r="1.1" fill="#fff" />
      <Circle cx="62.2" cy="44.8" r="1.1" fill="#fff" />
      <Ellipse cx="50" cy="56" rx="4.2" ry="3.2" fill={shade(p.skin, -0.12)} />
      <Path d="M42 63.5Q50 69 58 63.5" stroke={p.beard ? '#f2d3c8' : '#7a3f35'} strokeWidth="2" strokeLinecap="round" fill="none" />

      {p.glasses ? (
        <>
          <Circle cx="39" cy="47" r="10.5" stroke={INK} strokeWidth="1.8" fill="#fff" fillOpacity="0.08" />
          <Circle cx="61" cy="47" r="10.5" stroke={INK} strokeWidth="1.8" fill="#fff" fillOpacity="0.08" />
          <Path d="M49.5 46Q50 44.5 50.5 46M28.5 46L22 45M71.5 46L78 45" stroke={INK} strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </>
      ) : null}

      <FrontHair p={p} />

      {p.headset ? (
        <>
          <Path d="M20 44C20 12 80 12 80 44" stroke="#2a3140" strokeWidth="4" fill="none" strokeLinecap="round" />
          <Rect x="14.5" y="42" width="9" height="16" rx="4.5" fill="#2a3140" />
          <Rect x="76.5" y="42" width="9" height="16" rx="4.5" fill="#2a3140" />
          <Path d="M19 58Q21 70 38 70" stroke="#2a3140" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <Circle cx="39.5" cy="70" r="2.8" fill={accent} />
        </>
      ) : null}

      <Ellipse cx="40" cy="24" rx="14" ry="7" fill="#fff" opacity={p.hairStyle === 'bald' ? 0.22 : 0.1} />
    </Svg>
  );
}

export const AvatarFigure = memo(AvatarFigureBase);
