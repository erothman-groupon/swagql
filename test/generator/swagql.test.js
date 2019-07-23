'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const assert = require('assertive');
const { graphql } = require('graphql');
const { fetch } = require('gofer');
const http = require('http');

const generateSchema = require('../../lib/generate-schema');

describe('SwagQL', () => {
  let server, port;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/v2/pet/1') {
        res.end(
          JSON.stringify({
            id: 1,
            name: 'MaxTheDog',
            'is-nick-name': true,
            'age-in-dog-years': 49,
            '5 Things are Neato!': 'It works!',
            safe: {
              alsoSafe: {
                'Totally Not Safe!': { '4': 'Nested objects work too!' },
              },
            },
          })
        );
      } else if (req.url === '/v2/pet') {
        res.end(
          JSON.stringify({
            id: 2,
          })
        );
      }
    });
    port = await new Promise(resolve => {
      server.listen(0, () => {
        resolve(server.address().port);
      });
    });
  });

  after(() => server.close());

  it('creates a working module', async () => {
    const swaggerSchema = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'petstore.json'))
    );

    const gqlResult = await generateSchema(swaggerSchema, [
      path.join(__dirname, '..', 'fixtures', 'require-os-plugin.js'),
    ]);

    assert.truthy(
      'updatePet result includes parameter from path',
      gqlResult.ast.program.body
        .find(
          n =>
            n.type === 'VariableDeclaration' &&
            n.declarations[0].id.name === 'Mutation'
        )
        .declarations[0].init.arguments[0].properties.find(
          p => p.key.name === 'fields'
        )
        .value.properties.find(p => p.key.name === 'updatePet')
        .value.properties.find(p => p.key.name === 'args')
        .value.properties.find(p => p.key.name === 'debug')
    );

    // assert that the swagqlType is present and has the apiType object
    for (const p of gqlResult.ast.program.body) {
      if (!p.swagqlType) continue;
      assert.hasType(Object, p.swagqlType.apiType);
    }

    const { code: source } = gqlResult;

    // create and load a temporary graphql schema module
    const hypath = path.join(__dirname, '../../lib/schema.js');
    const gqlSchemaModule = new Module(hypath);
    gqlSchemaModule.filename = hypath;
    gqlSchemaModule.paths = Module['_nodeModulePaths'](
      path.join(__dirname, '..', '..')
    );
    gqlSchemaModule['_compile'](source, hypath);

    assert.match(/^\/\/ Generated by /, source.slice(0, source.indexOf('\n')));

    // check if our require-os plugin worked.
    assert.match(
      /const os = require\('os'\)/,
      source.slice(0, source.indexOf(';'))
    );

    const result = await graphql(
      gqlSchemaModule.exports.schema,
      `
        query MyQuery($petId: Int!) {
          petById(petId: $petId) {
            id
            name
            isNickName
            ageInDogYears
            _5ThingsAreNeato
            safe {
              alsoSafe {
                totallyNotSafe {
                  _4
                }
              }
            }
          }
        }
      `,
      null,
      {
        [gqlSchemaModule.exports.FETCH](urlPath, options) {
          return fetch(`http://localhost:${port}/v2${urlPath}`, options);
        },
        [gqlSchemaModule.exports.VERIFY_AUTH_STATUS]() {},
      },
      { petId: 1 }
    );
    assert.notEqual(null, result);
    assert.notEqual(null, result.data);
    assert.equal(undefined, result.errors);

    assert.notEqual(null, result.data.me);
    assert.equal(1, result.data.petById.id);

    assert.notEqual(null, result.data.myPlaces);

    assert.equal(true, result.data.petById.isNickName);
    assert.equal(49, result.data.petById.ageInDogYears);
    // eslint-disable-next-line no-underscore-dangle
    assert.equal('It works!', result.data.petById._5ThingsAreNeato);
    assert.equal(
      'Nested objects work too!',
      // eslint-disable-next-line no-underscore-dangle
      result.data.petById.safe.alsoSafe.totallyNotSafe._4
    );

    const mutation = await graphql(
      gqlSchemaModule.exports.schema,
      `
        mutation AddPet($body: PetInput!) {
          addPet(body: $body) {
            rawInputOptions
          }
        }
      `,
      null,
      {
        [gqlSchemaModule.exports.FETCH](urlPath, options) {
          return fetch(`http://localhost:${port}/v2${urlPath}`, options);
        },
        [gqlSchemaModule.exports.VERIFY_AUTH_STATUS]() {},
      },
      {
        body: {
          name: 'Fido',
          photoUrls: '/photo.png',
          ageInDogYears: 5,
          isNickName: false,
        },
      }
    );
    assert.notEqual(null, mutation);
    assert.equal('Fido', mutation.data.addPet.rawInputOptions.body.name);
    assert.equal(
      5,
      mutation.data.addPet.rawInputOptions.body['age-in-dog-years']
    );
    assert.equal(
      false,
      mutation.data.addPet.rawInputOptions.body['is-nick-name']
    );
  });
});
