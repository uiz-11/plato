# How air scatters sunlight

On a clear day the sky is blue overhead, paler near the horizon, and red or orange around the setting Sun, while the clouds stay white. All of these colours come from the same sunlight meeting the same air. What differs is the size of the things the light meets and how far it travels through them. :cite[src-nasa-blue-sky]

## Sunlight is every colour at once

::anchor{#a-white-light}

Sunlight contains every visible wavelength, from violet at about 400 nanometres to red at about 700. Mixed together, these wavelengths look white, which is the colour the Sun has when seen from space. :cite[src-nasa-blue-sky]

The colours we see in the sky are what is left of that mixture after the atmosphere has redirected some wavelengths more than others. Nothing in the air adds colour; it only sorts the colours that are already there. :cite[src-wiki-diffuse-sky]

## Small molecules prefer short waves

::anchor{#a-rayleigh}

Air is mostly nitrogen and oxygen molecules, which are thousands of times smaller than a wavelength of visible light. When light meets particles this small, a little of it is scattered: sent off in a new direction. This is called *Rayleigh scattering*, after the physicist who worked out its rules in the 1870s. :cite[src-wiki-rayleigh]

The key rule is that the strength of the scattering depends steeply on wavelength. :cite[src-wiki-rayleigh]

$$
\text{scattering} \propto \frac{1}{\lambda^4}
$$

Halving the wavelength makes the scattering $2^4 = 16$ times stronger. :cite[src-wiki-rayleigh]

:::analogy{#an-ripples}
Think of ripples on a pond meeting a thin reed. Short, choppy ripples are disturbed by the reed and spread out around it, while long, slow swells roll past almost as if it were not there.
:::

::guess{#g-ratio}

Blue light at about 450 nanometres is scattered roughly six times more strongly than red light at about 700, because $(700/450)^4 \approx 5.9$. :general[This follows from applying the fourth-power law to the two wavelengths.]

So as sunlight crosses the atmosphere, a share of its blue is scattered out of the beam in every direction, including towards you, wherever you look. The sky glows blue because blue light reaches your eye from all of it, not just from the direction of the Sun. :cite[src-wiki-diffuse-sky]

::misconception{#m-ocean}

Without air there is nothing to scatter the light. On the Moon, which has no atmosphere, the sky is black even in full sunlight. :cite[src-wiki-diffuse-sky]

## Why blue and not violet

::anchor{#a-not-violet}

Violet has a shorter wavelength than blue, so it is scattered even more. The sky still looks blue for two reasons. :cite[src-wiki-diffuse-sky]

- Sunlight contains less violet than blue to begin with. :cite[src-wiki-diffuse-sky]
- Our eyes are much less sensitive to violet than to blue, so the scattered mixture of violet, blue and some green registers as a pale sky blue. :cite[src-wiki-diffuse-sky]

::misconception{#m-violet-sky}

The sky is also paler near the horizon than overhead. Light from low in the sky has crossed more air and been scattered many times, which mixes the colours back towards white. :cite[src-wiki-diffuse-sky]

## Red sunsets

::anchor{#a-sunset}

When the Sun is overhead, its light crosses the atmosphere by the shortest route. When it is low, the light skims through the curved layer of air and crosses far more of it. :cite[src-wiki-air-mass]

::figure{src="sun-path.svg" alt="The Sun overhead sends light straight down through a short path of air; the Sun at the horizon sends light along a much longer path." caption="Sunlight's path through the air at noon and at sunset."}

::guess{#g-sunset}

Astronomers measure this as *air mass*: 1 for the Sun straight overhead, and close to 40 at the horizon. :cite[src-wiki-air-mass]

Along that long path, most of the blue is scattered out of the direct beam before the light reaches you. What is left is mostly orange and red, which colours the Sun itself and the clouds it lights from below. :cite[src-wiki-rayleigh]

The blue has not disappeared. It has been scattered sideways and is lighting the sky for people farther along, for whom the Sun is still higher. :general[This follows from the scattering described above.]

Dust, smoke and pollution add particles that scatter and absorb light too, which is why sunsets after a wildfire or a volcanic eruption can be especially deep red. :uncertain[How much each kind of particle contributes varies a great deal from one sunset to the next.]

## White clouds

::anchor{#a-clouds}

Cloud droplets are very different from air molecules. A typical droplet is about a hundredth of a millimetre across, many times larger than a wavelength of visible light. :cite[src-wiki-mie]

Scattering by particles this large is described by *Mie scattering*, and for droplets of this size it scatters all visible wavelengths about equally. Sunlight scattered by a cloud therefore keeps its full mixture of colours, and the cloud looks white. :cite[src-wiki-mie]

Thick clouds look grey or dark from below because so little light makes it all the way through them, not because their droplets have changed colour. :cite[src-wiki-mie]

Mist, fog and some kinds of haze work the same way, which is why a hazy summer sky looks whitish rather than deep blue. :cite[src-wiki-mie]

## One rule, three colours

Whether light meets something small or something large, and how much air it crosses, decides the colour we see. :general[This is a summary of the lesson.]

| What the light meets | Typical size | What scatters most | What we see |
|---|---|---|---|
| Air molecules | far smaller than a wavelength | blue and violet | blue sky |
| Long path of air at sunset | (same molecules) | blue, removed from the beam | red Sun |
| Cloud droplets | larger than a wavelength | all colours equally | white clouds |

Small molecules favour short wavelengths, so the sky is blue. A long path strips those short wavelengths from the direct light, so sunsets are red. Large droplets treat every colour alike, so clouds are white. :cite[src-nasa-blue-sky]
