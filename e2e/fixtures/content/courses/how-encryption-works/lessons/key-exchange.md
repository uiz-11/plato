# Agreeing on a secret in public

Symmetric ciphers need both sides to hold the same key, and for centuries that meant meeting in person or trusting a courier. In 1976 Whitfield Diffie and Martin Hellman published a way for two strangers to agree on a shared key while an eavesdropper hears every word they say. :cite[src-diffie-hellman]

::guess{#g-public-channel}

## Clock arithmetic

::anchor{#a-clock-maths}

The trick rests on *modular arithmetic*, which you already use when reading a clock. Five hours after 10 o'clock is not 15 o'clock but 3 o'clock, because the hours wrap around at 12. Mathematicians write this as $15 \bmod 12 = 3$: divide by the *modulus* and keep the remainder. :general[Modular arithmetic is standard school mathematics.]

::guess{#g-clock}

Powers behave neatly under a modulus. To find $2^5 \bmod 7$, compute $2^5 = 32$ and take the remainder after dividing by 7, which is 4. Computers can do this quickly even for numbers hundreds of digits long, by reducing after every multiplication so the numbers never grow large. :general[Fast modular exponentiation is a standard algorithm.]

In Python the built-in `pow` takes the modulus as a third argument, as in `pow(2, 5, 7)`, which returns 4. :general[This is documented Python behaviour.]

## The exchange

::anchor{#a-exchange}

Alice and Bob first agree, in public, on two numbers: a large prime $p$ and a base $g$. Then each side does three things. :cite[src-diffie-hellman]

1. Pick a private number and tell nobody: Alice picks $a$, Bob picks $b$. :cite[src-diffie-hellman]
2. Send the public value $A = g^a \bmod p$ or $B = g^b \bmod p$ to the other side, in the open. :cite[src-diffie-hellman]
3. Raise the value received to your own private number. :cite[src-diffie-hellman]

Both end up with the same number, because the order of the exponents does not matter. :cite[src-diffie-hellman]

$$
B^a \bmod p \;=\; A^b \bmod p \;=\; g^{ab} \bmod p
$$

That shared number is the secret key, ready for a symmetric cipher such as AES. :cite[src-diffie-hellman]

Here is a worked example with numbers small enough to check by hand. Take $p = 23$ and $g = 5$. Alice picks $a = 6$ and sends $A = 5^6 \bmod 23 = 8$. Bob picks $b = 15$ and sends $B = 5^{15} \bmod 23 = 19$. Alice computes $19^6 \bmod 23 = 2$ and Bob computes $8^{15} \bmod 23 = 2$. Both now hold the secret 2, and it never crossed the wire. :general[These values can be checked with any calculator.]

:::analogy{#paint}
Picture it with paint. Alice and Bob agree in public on a common yellow. Each secretly mixes in a private colour and sends the mixture across. Each then adds their own private colour to the mixture they received. Both tubs now hold the same brown, made from yellow plus both secret colours. An onlooker saw yellow and the two mixtures, but un-mixing paint to recover a secret colour is impractical.
:::

::figure{src="paint-mixing.svg" alt="Alice and Bob each mix a private colour into a shared public colour, swap the mixtures, and add their private colour again, ending with the same final colour." caption="The paint-mixing picture of a Diffie–Hellman exchange."}

## Why eavesdroppers are stuck

::anchor{#a-hard-problem}

An eavesdropper, Eve, sees $p$, $g$, $A$ and $B$. To get the secret she needs $a$ or $b$. Recovering $a$ from $A = g^a \bmod p$ is the *discrete logarithm problem*, and for a well-chosen prime of 2048 bits, a number more than 600 decimal digits long, no known method on ordinary computers solves it in any useful time. :cite[src-diffie-hellman]

::misconception{#m-eavesdrop-sees}

This is the pattern behind all public-key cryptography: an operation that is easy in one direction and, as far as anyone knows, infeasible to reverse. Diffie and Hellman called such operations one-way functions and built their exchange on one. :cite[src-diffie-hellman] :general[For well-chosen 2048-bit primes, computing $g^a \bmod p$ takes microseconds, while no known classical method undoes it in any practical time.]

That hardness is believed, not proved. :uncertain[Nobody has proved that the discrete logarithm problem has no fast classical solution, though decades of effort have not found one.] The next lesson returns to this when it asks what a quantum computer would change.

Every time your browser opens a secure connection, TLS 1.3 runs a Diffie–Hellman exchange, usually on elliptic curves rather than with plain numbers, to agree on fresh keys for that session alone. :cite[src-rfc-8446]

## The gap that remains

Diffie–Hellman protects against an eavesdropper who only listens. It does not, on its own, tell Alice that the public value she received really came from Bob. An attacker who can change messages could run one exchange with Alice and another with Bob, and read everything in between. :cite[src-rfc-8446]

Closing that gap needs a way to prove who sent a public value. That is the job of digital signatures. :cite[src-diffie-hellman]
