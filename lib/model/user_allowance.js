
/*
 *  This class represent Employee's allowance.
 *
 *  As allowance became quite complicated entity, which is calculated
 *  based on few sources, there was decision to move allowance calculation
 *  logic out into its own class.
 *
 * */

"use strict";

const moment = require('moment');
const Promise = require('bluebird');
const Joi = require('joi');

/*
 *  Section where we declare interfaces used in methods for this class.
 * */

const schema_user = Joi.object().required();

const schema_year = Joi.object().custom((value, helpers) => {
  if (!moment.isMoment(value)) {
    return helpers.error('any.invalid');
  }
  return value;
}).default(() => moment.utc(), 'Default year is current one');

const schema_now = Joi.object().custom((value, helpers) => {
  if (!moment.isMoment(value)) {
    return helpers.error('any.invalid');
  }
  return value;
}).default(() => moment.utc(), 'Default is UTC one not from company specific');

const schema_promise_allowance = Joi.object({
  year: schema_year,
  user: schema_user,
  now: schema_now,
  forceNow: Joi.boolean().default(false),
}).required();

const scheme_constructor = Joi.object({
  user: schema_user,
  number_of_days_taken_from_allowance: Joi.number().required(),
  manual_adjustment: Joi.number().required(),
  carry_over: Joi.number().required(),
  nominal_allowance: Joi.number().required(),
  now: schema_now,
}).required();

/*
 *  Class definition.
 *
 * */

class UserAllowance {

  constructor(args) {
    // Validate provided parameters
    args = Joi.attempt(
      args,
      scheme_constructor,
      'Failed parameters validation for UserAllowance constructor'
    );

    this._user = args.user;
    this._number_of_days_taken_from_allowance = args.number_of_days_taken_from_allowance;
    this._manual_adjustment = args.manual_adjustment;
    this._carry_over = args.carry_over;
    this._nominal_allowance = args.nominal_allowance;
    this._now = args.now;
  }

  get total_number_of_days_in_allowance() {
    return (this.nominal_allowance +
      this.carry_over +
      this.manual_adjustment +
      this.employement_range_adjustment);
  }

  get number_of_days_taken_from_allowance() {
    return this._number_of_days_taken_from_allowance;
  }

  get manual_adjustment() {
    return this._manual_adjustment;
  }

  get carry_over() {
    return this._carry_over;
  }

  get nominal_allowance() {
    return this._nominal_allowance;
  }

  get number_of_days_available_in_allowance() {
    if (this.user.start_date &&
      moment.utc(this.user.start_date).year() > this._now.year()
    ) {
      return 0;
    }

    return (
      this.total_number_of_days_in_allowance
      - this.number_of_days_taken_from_allowance
      + (this.is_accrued_allowance ? this.accrued_adjustment : 0)
    );
  }

  get is_accrued_allowance() {
    return !!this.user.department.is_accrued_allowance;
  }

  get user() {
    return this._user;
  }

  get employement_range_adjustment() {
    let now = this._now.clone();

    if (
      now.year() !== moment.utc(this.user.start_date).year()
      && (!this.user.end_date || moment.utc(this.user.end_date).year() > now.year())
    ){
      return 0;
    }

    let start_date = moment.utc(this.user.start_date).year() === now.year()
      ? moment.utc(this.user.start_date)
      : now.clone().startOf('year');

    let end_date = this.user.end_date && moment.utc(this.user.end_date).year() <= now.year()
      ? moment.utc(this.user.end_date)
      : now.clone().endOf('year');

    return -1 * (this.nominal_allowance - Math.round(
      this.nominal_allowance * end_date.diff(start_date, 'days') / 365
    ));
  }

  get accrued_adjustment() {
    const now = this._now.clone();
    const allowance = this.nominal_allowance
      + this.manual_adjustment
      + this.employement_range_adjustment;

    const period_starts_at = moment.utc(this.user.start_date).year() === now.year()
      ? moment.utc(this.user.start_date)
      : now.clone().startOf('year');

    const period_ends_at = this.user.end_date && moment.utc(this.user.end_date).year() <= now.year()
      ? moment.utc(this.user.end_date)
      : now.clone().endOf('year');

    let days_in_period = period_ends_at.diff(period_starts_at, 'days');

    let delta = allowance * period_ends_at.diff(now, 'days') / days_in_period;

    return -1 * (Math.round(delta * 2) / 2).toFixed(1);
  }

  static promise_allowance(args) {
    args = Joi.attempt(
      args,
      schema_promise_allowance,
      'Failed to validate parameters for promise_allowance'
    );

    let user = args.user;
    let year = args.year;
    let number_of_days_taken_from_allowance;
    let manual_adjustment;
    let carried_over_allowance;

    const { forceNow, now } = args;

    let flow = Promise.resolve();

    if (user.my_leaves === undefined) {
      flow = flow.then(() => user.reload_with_leave_details({ year }));
    }

    flow = flow.then(() => user.promise_adjustment_and_carry_over_for_year(year));

    flow = flow.then(adjustment_and_coa => {
      manual_adjustment = adjustment_and_coa.adjustment;
      carried_over_allowance = adjustment_and_coa.carried_over_allowance;
      return Promise.resolve();
    });

    flow = flow.then(() => Promise.resolve(
      number_of_days_taken_from_allowance = user.calculate_number_of_days_taken_from_allowance({ year: year.format('YYYY') })
    ));

    flow = flow.then(() => {
      const args = {
        user,
        manual_adjustment,
        number_of_days_taken_from_allowance,
        carry_over: carried_over_allowance,
        nominal_allowance: user.department.allowance,
      };

      if (forceNow && now) {
        args.now = now;
      } else if (year && year.year() !== moment.utc().year()) {
        args.now = year.startOf('year');
      }

      return new UserAllowance(args);
    });

    return flow;
  }
}

module.exports = UserAllowance;
