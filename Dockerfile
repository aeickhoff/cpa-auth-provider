FROM node:7.7

# Install dependencies
RUN apt-get update && apt-get install -y \
  libsqlite3-dev apt-transport-https

RUN npm install -g node-gyp

RUN yarn global add sequelize-cli

ADD package.json /src/package.json
ADD passport-openam /src/passport-openam

# Install Node.js dependencies
WORKDIR /src
RUN npm install

# Configure
ADD config.docker.js /src/config.local.js

ENV NODE_ENV development

ENV IDP_RECAPCHA_SITEKEY 6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI
ENV IDP_RECAPCHA_SECRETKEY 6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe
ENV JWT_SECRET AlteredCarbonFly
ENV DEFAULT_LOCALE fr

# default settings for database
ENV DB_TYPE sqlite
ENV DB_FILENAME "data/identity-provider.sqlite"

ADD config.js /src/config.js
ADD db_config.js /src/db_config.js
ADD bin /src/bin
ADD lib /src/lib
ADD models /src/models
ADD public /src/public
ADD routes /src/routes
ADD views /src/views
ADD templates /src/templates
ADD locales /src/locales
ADD migrations /src/migrations
ADD seeders /src/seeders

# TODO find better way to run tests without adding test file to the image
ADD test /src/test
ADD config.test.js /src/config.test.js

# Create the sqlite database
RUN mkdir data
RUN bin/init-db

# By default, the application listens for HTTP on port 3000
EXPOSE 3000

CMD ["bin/server"]
