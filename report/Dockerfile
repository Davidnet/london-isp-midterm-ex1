# Pandoc + minimal TeX Live, extended with the tufte-handout class and the
# packages it pulls in. latest-ubuntu is the multi-arch tag (arm64 + amd64).
FROM pandoc/latex:latest-ubuntu

RUN tlmgr update --self \
  && tlmgr install \
    tufte-latex \
    hardwrap \
    titlesec \
    xifthen \
    ifmtarg \
    changepage \
    paralist \
    placeins \
    ragged2e \
    sauerj \
    setspace \
    textcase \
    fmtcount \
    catchfile \
    transparent \
    morefloats \
    xkeyval \
    xltxtra \
    realscripts \
    metalogo \
    mparhack
