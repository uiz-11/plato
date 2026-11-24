# Fingerprints for data

Encryption hides what a message says. A different tool answers a different question: is this exactly the data I expected, down to the last bit? That tool is the cryptographic hash function. :cite[src-fips-180]

## A fixed-length fingerprint

::anchor{#a-fingerprint}

A hash function takes any input, from a single word to a whole film, and produces a short output of fixed length called a *hash* or *digest*. SHA-256, one of the hash functions in NIST's Secure Hash Standard, always produces 256 bits, usually written as 64 hexadecimal characters. :cite[src-fips-180]

::guess{#g-hash-length}

Here is SHA-256 computed with Python's standard library, for two inputs that differ in a single letter. :cite[src-fips-180]

```python
import hashlib

hashlib.sha256(b"hello").hexdigest()
# '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

hashlib.sha256(b"Hello").hexdigest()
# '185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969'
```

Changing one letter from lower to upper case produced a hash with no visible resemblance to the first. Good hash functions are designed so that flipping any single input bit changes about half of the output bits, a property called the *avalanche effect*. :general[The avalanche effect is a standard design goal for hash functions.]

This is what makes a hash useful as a fingerprint. Software publishers list the SHA-256 hash of each download. After downloading, you compute the hash yourself; if even one byte was corrupted or swapped by an attacker, the hashes will not match. :general[Publishing checksums next to downloads is common practice.]

A hash uses no key at all. Anyone can compute it, and anyone gets the same answer for the same input. :cite[src-fips-180]

Hashes also make good names for data. Version-control systems such as Git identify every file and every saved change by its hash, so any edit to past history changes the names of everything after it and is immediately visible. :general[Git's content addressing by hash is widely documented.]

## One way only

::anchor{#a-one-way}

A cryptographic hash is designed to be *one-way*: given a hash, there should be no practical way to find an input that produces it, other than guessing inputs and checking each one. :cite[src-fips-180]

::misconception{#m-hash-reversible}

One-way hashing is how well-run websites store passwords. The site keeps only a hash of your password. When you log in, it hashes what you typed and compares the result with the stored hash. If the database is stolen, the attacker gets hashes, not passwords. :cite[src-owasp-passwords]

Attackers respond by guessing: they hash millions of common passwords and look for matches. So password storage adds two defenses. :cite[src-owasp-passwords]

- A *salt*, a random value stored next to each hash and mixed into it, so two people with the same password get different hashes and precomputed tables become useless. :cite[src-owasp-passwords]
- A deliberately *slow* hash function, such as Argon2 or bcrypt, so each guess costs the attacker real time. A fast hash like SHA-256 is the wrong tool for passwords. :cite[src-owasp-passwords]

::guess{#g-password-storage}

## When fingerprints collide

::anchor{#a-collisions}

Because a hash is shorter than most inputs, different inputs must sometimes share the same hash. A pair like that is a *collision*. Collisions always exist; the security goal is that nobody can *find* one. :cite[src-fips-180]

Finding a collision by brute force takes about $2^{n/2}$ tries for an $n$-bit hash, because of the same arithmetic that makes two people in a room of 23 likely to share a birthday. For SHA-256 that is about $2^{128}$ tries, far out of reach. :general[This is the birthday bound, a standard result in probability.]

| Hash | Output length | Status |
|---|---|---|
| MD5 | 128 bits | broken |
| SHA-1 | 160 bits | broken |
| SHA-256 | 256 bits | no practical attacks known |

A broken hash is one where researchers have found a shortcut to collisions. In 2017 a team from CWI Amsterdam and Google produced two different PDF files with the same SHA-1 hash, using a clever attack far faster than brute force. :cite[src-shattered]

MD5, an older 128-bit hash, fell earlier still. Collisions for it can now be found in seconds on a laptop, and attackers have used MD5 collisions to forge trusted certificates. :general[MD5's breakage is well documented in the security literature.]

A collision lets an attacker swap one document for another. If someone vouches for a hash, as you will see when this course reaches digital signatures, a colliding twin of the document inherits that trust. That is why SHA-1 has been retired from new uses in favor of the SHA-2 family. :cite[src-shattered]

## What hashes do and do not do

A hash gives you integrity: proof that data has not changed. It does not give you secrecy, since the hash of a guessable input can be found by guessing, and on its own it does not tell you *who* produced the data. Anyone can hash a forged file and publish the result. :general[Integrity, secrecy and authenticity are distinct security goals.]

Those missing pieces are what the second module is about. First comes a way for two strangers to share a key, and then a way to prove who is speaking. :general[This is an outline of the rest of the course.]
