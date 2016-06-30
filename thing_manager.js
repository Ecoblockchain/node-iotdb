/*
 *  thing_manager.js
 *
 *  David Janes
 *  IOTDB.org
 *  2014-02-18
 *
 *  Copyright [2013-2016] [David P. Janes]
 *
 *  Things Manager. Handle finding new Things and
 *  tracking things that we already know about.
 *  This replaces massive amounts of code in 'IOTDB'
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

"use strict";

const _ = require('./helpers');
const modules = require("./modules").modules;

const iotdb_thing = require('iotdb-thing');
const thing_set = require('./thing_set');
const exit = require('./exit');

const events = require('events');

const logger = _.logger.make({
    name: 'iotdb',
    module: 'things',
});

const make = function (initd) {
    const self = Object.assign({}, events.EventEmitter.prototype);
    const iotdb = require("./iotdb");

    const _initd = _.defaults(initd, {});
    let _thingd = {};
    let _bridge_exemplars = [];
    let _tid = 0;

    self.setMaxListeners(0);

    /**
     *  This is for testing only
     */
    self._reset = function () {
        _thingd = {};
        _bridge_exemplars = [];
    };

    /**
     *  Return all things that we know about
     */
    self.things = function () {
        var things = thing_set.make();

        self.on("thing", thing => things.add(thing))

        _.mapObject(_thingd, ( thing, thing_id ) => things.add(thing))

        return things;
    };

    /**
     *  Find new things. This is probably one 
     *  of the most important functions! Can
     *  be called with 0, 1, 2 or 3 arguments
     *  depending on your mood.
     */
    self.connect = function (modeld, initd, metad) {
        logger.info({
            method: "connect",
            modeld: modeld,
        }, "called");

        if (!modeld) {
            modeld = {};
        } else if (_.is.String(modeld)) {
            modeld = {
                model_code: _.id.to_dash_case(modeld)
            };
        } else if (_.is.Object(modeld)) {
            /* XXX self needs to be rationalized */
            if (modeld.model) {
                modeld.model_code = modeld.model;
            }

            if (!_.is.String(modeld.model_code)) {
                throw new Error("expected *.model_code to be a string");
            }

            modeld = _.d.clone.deep(modeld);
            modeld.model_code = _.id.to_dash_case(modeld.model_code);
        } else {
            throw new Error("expected undefined|null|string|dictionary");
        }

        if (initd !== undefined) {
            if (!_.is.Object(initd)) {
                throw new Error("expected initd to be a Dictionary");
            }

            modeld = _.defaults(modeld, initd);
        }

        if (metad !== undefined) {
            if (!_.is.Object(metad)) {
                throw new Error("expected metad to be a Dictionary");
            }

            modeld["meta"] = metad;
        }

        const things = thing_set.make({
            persist: true,
            things: self,
        });

        process.nextTick(function () {
            if (modeld.model_code) {
                _discover_model(things, modeld);
            } else {
                _discover_all(things, modeld);
            }
        });

        return things; 
    };

    const _discover_model = function (things, modeld) {
        const any = modules().bindings()
            .filter(binding => modeld.model_code === binding.model_code)
            // .map(binding => { console.log("binding"); return binding })
            .find(binding => _discover_binding(things, modeld, binding));

        if (!any) {
            logger.error({
                method: "_discover",
                modeld: modeld,
                cause: "maybe Model or it's binding are not added to IOTDB yet?",
            }, "did not find any matching Models");
        }
    };

    const _discover_all = function (things, modeld) {
        modules().bindings()
            .filter(binding => binding.discover !== false)
            .map(binding => _discover_binding(things, modeld, binding));
    };

    const _discover_binding = function (things, modeld, binding) {
        logger.info({
            method: "_discover_binding",
            modeld: modeld,
            binding: binding ? "YES" : "-",
        }, "called");

        // initialize the bridge for self binding
        const initd = _.defaults({}, modeld, binding.initd);

        const bridge_exemplar = new binding.bridge(initd);
        _bridge_exemplars.push(bridge_exemplar);

        bridge_exemplar.discovered = function (bridge_instance) {
            _discover_binding_bridge(things, modeld, binding, bridge_exemplar, bridge_instance);
        };

        // and kick off the discovery … later
        process.nextTick(function () {
            bridge_exemplar.discover();
        });

        return true;
    };

    const _build_universal_thing_id = thing => {
        const thing_id = thing.thing_id();
        const model_id = thing.model_id();
        const runner_id = iotdb.keystore().get("/homestar/runner/keys/homestar/key", null);
        // console.log("HERE:MODEL", thing.model_id(), thing.state("model"));
        // process.exit()


        if (runner_id) {
            return _.id.uuid.iotdb("t", runner_id.replace(/^.*:/, '') + ":" + _.hash.short(thing_id + ":" + model_id));
        } else {
            return thing_id + ":" + model_id;
        }
    };

    const _bind_thing_bridge = (thing, bridge, binding) => {
        const thing_id = _build_universal_thing_id(thing);

        const _reachable_changed = is_reachable => {
            thing.band("connection").set("iot:reachable", is_reachable);
        };

        const _update_from_mapping = pulld => {
            const mapping = bridge.binding.mapping;
            if (!mapping) {
                return pulld;
            }

            pulld = _.d.clone.shallow(pulld);

            _.pairs(pulld)
                .map(pkv => ({
                    key: pkv[0],
                    value: pkv[1],
                    cvalue: _.ld.compact(pkv[1]),
                    md: mapping[pkv[0]]
                }))
                .filter(d => d.md)
                .forEach(d => {
                    _.pairs(d.md)
                        .filter(mkv => (mkv[1] === d.value) || (mkv[1] === d.cvalue))
                        .forEach(mkv => pulld[d.key] = mkey[0])
                    });

            return pulld;
        }

        const _pull_istate = pulld => {
            pulld = _.timestamp.add(pulld);
            // pulld = _update_from_mapping(pulld);

            thing.band("istate").update(pulld, {
                add_timestamp: true,
                check_timestamp: true,
                validate: false,
            });
        };

        const _pull_meta = pulld => {
            _reachable_changed(bridge.reachable() ? true : false);

            let metad = bridge.meta();
            metad["iot:thing-id"] = thing_id;

            thing.band("meta").update(metad, {
                add_timestamp: true,
                check_timestamp: false,
            });
        };

        bridge.pulled = pulld => {
            if (pulld) {
                _pull_istate(pulld);
            } else {
                _pull_meta();
            } 
        };

        const _on_ostate = ( thing, band, state ) => {
            if (bridge._thing && bridge._thing !== thing) {
                thing.removeListener("ostate", _on_ostate);
            }

            state = _.object(_.pairs(state)
                .filter(p => p[1] !== null)
                .filter(p => !p[0].match(/^@/)));
            if (_.is.Empty(state)) {
                return;
            }
            
            bridge.push(state, () => {
                thing.update("ostate", {});
            });
        };

        thing.on("ostate", _on_ostate);

        bridge._thing = thing;

        _pull_meta();

        bridge.connect(_.d.compose.shallow(binding.connectd, {}));
        bridge.pulled();

        return self;
    };

    /**
     *  This is called after a Bridge Instance is found.
     *  - make sure we're not shutting down
     *  - make sure it's a match for the binding
     *  - make a Model Instance - a thing - bound to the Bridge Instance
     *  - check thing.thing_id to see if already exists
     *  - if new
     *      - connect
     *      - emit
     *  - if existing
     *      - see if exiting one is reachable?
     *      - if it isn't, replace the bridge with self one
     */
    const _discover_binding_bridge = function (things, modeld, binding, bridge_exemplar, bridge_instance) {
        if (exit.shutting_down()) {
            return;
        }

        logger.info({
            method: "_discover_binding_bridge",
            modeld: modeld,
            binding: binding ? "YES" : "-",
            bridge_instance: bridge_instance.meta(),
        }, "called");

        // bindings can ignore certatin discoveries 
        if (binding && binding.matchd) {
            const bridge_meta = _.ld.compact(bridge_instance.meta());
            const binding_meta = _.ld.compact(binding.matchd);
            if (!_.d.is.superset(bridge_meta, binding_meta)) {
                if (bridge_exemplar.ignore) {
                    bridge_exemplar.ignore(bridge_instance);
                }

                return;
            }
        }

        if (1) {
            // G3
            const bandd = _.d.clone.deep(binding.bandd);
            bandd.meta = {};
            bandd.istate = {};
            bandd.ostate = {};
            bandd.connection = {};

            const new_thing = iotdb_thing.make(bandd);
            const new_thing_id = _build_universal_thing_id(new_thing);
            new_thing._tid = _tid++;

            const old_thing = _thingd[new_thing_id];
            if (!old_thing) {
                _thingd[new_thing_id] = new_thing;

                _bind_thing_bridge(new_thing, bridge_instance, binding);

                things.add(new_thing);

                self.emit("thing", new_thing);
            } else if (new_thing.reachable()) {
                return; // don't replace reachable things
            } else if (!bridge_instance.reachable()) {
                return; // don't replace with an unreachable thing
            } else {
                console.log("SHOULD REPLACE AN OLD THING", old_thing.reachable(), new_thing.reachable());
                _bind_thing_bridge(old_thing, bridge_instance, binding);
            }
        } else {
            // keep the binding with the Bridge 
            bridge_instance.binding = binding;

            // now make a model 
            const model_instance = new binding.model();
            model_instance.bind_bridge(bridge_instance);

            // is already being tracked? is it reachable if it is ?
            const thing_id = model_instance.thing_id();
            let thing = _thingd[thing_id];

            if (modeld.meta) {
                model_instance.update("meta", modeld.meta);
            }

            if (!thing) {
                // add the new thing
                thing = model_instance;
                _thingd[thing_id] = thing;

                // bring it into play
                var connectd = _.defaults(binding.connectd, {});
                bridge_instance.connect(connectd)

                // add to the set of things we have built up for self connect
                things.add(thing);

                // tell the world
                self.emit("thing", thing);
            } else if (thing.reachable()) {
                // don't replace reachable things
                return;
            } else if (!bridge_instance.reachable()) {
                // don't replace with an unreachable thing
                return;
            } else {
                // replace the bridge for the existing thing 
                thing.bind_bridge(bridge_instance);

                // bring it into play
                var connectd = _.defaults(binding.connectd, {});
                bridge_instance.connect(connectd)

                // self forces a metadata update
                bridge_instance.pulled();
            }
        }
    };

    /*
     *  Disconnect all the bridges and things,
     *  returning the amount of time we should wait
     *  before exiting
     */
    self.disconnect = () => {
        return _.flatten([ _bridge_exemplars, _.values(_thingd) ], true)
            .filter(bort => bort.disconnect)
            .map(bort => bort.disconnect())
            .filter(wait => _.is.Number(wait))
            .reduce(( sum, wait ) => sum + wait, 0);
    };

    return self;
}

/*
 *  API
 */
exports.make = make;
