'use client';

import { CalendarSelect as Select } from '../../../../components/calendar-select';

import { ActionIcon, Badge, Box, Button, Divider, Group, Stack, Switch, Text, TextInput, Textarea, UnstyledButton } from '../../../../components/calendar-ui';
import {
  IconBell,
  IconClipboardCheck,
  IconClock,
  IconMapPin,
  IconNotes,
  IconRepeat,
  IconStethoscope,
  IconTrash,
  IconUser,
  IconVideo,
  IconX,
} from '../../../../components/calendar-icons';
import type { AppointmentFormControls, CalendarEvent, SelectOption } from '../../types/index';
import { CalendarModal, CalendarManagedForm, CalendarDismiss } from '../../../../components/calendar-surfaces';
import { CalendarDateField } from '../../../../components/calendar-date-field';
import type { ReactNode } from 'react';

export interface AppointmentModalProps {
  opened: boolean;
  onClose: () => void;
  event: CalendarEvent | null;
  isAddMode: boolean;
  selectedStartTime: string | null;
  selectedEndTime: string | null;
  startTimeOptions: string[] | SelectOption[];
  endTimeOptions: string[] | SelectOption[];
  onStartTimeChange: (value: string | null) => void;
  onEndTimeChange: (value: string | null) => void;
  patientOptions?: SelectOption[];
  providerOptions?: SelectOption[];
  visitTypeOptions?: SelectOption[];
  /** Additive controlled behavior: retain the original compact presentation. */
  form?: AppointmentFormControls;
}

/** Content only: a connected adapter supplies its native async modal/form owner. */
export type AppointmentModalContentProps = Omit<AppointmentModalProps, 'opened' | 'onClose' | 'form'> & {
  form?: Omit<AppointmentFormControls, 'onSubmit'>;
  footer?: ReactNode;
  titleMaxLength?: number;
};

const defaultPatientOptions: SelectOption[] = [
  { value: 'patient-1', label: 'Roy Houchin' },
  { value: 'patient-2', label: 'Hannah Li' },
  { value: 'patient-3', label: 'Maya Patel' },
];

const defaultProviderOptions: SelectOption[] = [
  { value: 'dr-rhodes', label: 'Dr. Alicia Rhodes' },
  { value: 'jordan-mckee', label: 'Jordan McKee, LCSW' },
];

const defaultVisitTypeOptions: SelectOption[] = [
  { value: 'intake', label: 'Initial Intake' },
  { value: 'follow-up', label: 'Follow-up' },
  { value: 'med-mgmt', label: 'Med Management' },
  { value: 'therapy', label: 'Therapy Session' },
];

const recurrenceOptions: SelectOption[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
];

const locationOptions: SelectOption[] = [
  { value: 'telehealth', label: 'Telehealth' },
  { value: 'in-person', label: 'In-Person' },
  { value: 'phone', label: 'Phone' },
];

const reminderOptions: SelectOption[] = [
  { value: '15', label: '15 min before' },
  { value: '30', label: '30 min before' },
  { value: '60', label: '1 hour before' },
];

/**
 * Appointment Modal - beautiful, compact design
 */
export function AppointmentModal({
  opened,
  onClose,
  event,
  isAddMode,
  selectedStartTime,
  selectedEndTime,
  startTimeOptions,
  endTimeOptions,
  onStartTimeChange,
  onEndTimeChange,
  patientOptions = defaultPatientOptions,
  providerOptions = defaultProviderOptions,
  visitTypeOptions = defaultVisitTypeOptions,
  form,
}: AppointmentModalProps) {
  if (!event) return null;
  const block = form?.kind === 'block';
  const heading = form?.heading ?? (block ? isAddMode ? 'Block Time' : 'Edit Time Block' : isAddMode ? 'New Appointment' : 'Edit Appointment');

  return <CalendarModal opened={opened} onClose={onClose} size="var(--calendar-size-420)" radius="md" title={heading}
    padding={0} trigger={form?.trigger} closeOnEscape={form?.closeOnEscape}>
    <CalendarManagedForm noValidate onAccept={() => form ? !form.submitDisabled && form.onSubmit() !== false : true}>
      <AppointmentModalContent event={event} isAddMode={isAddMode} selectedStartTime={selectedStartTime} selectedEndTime={selectedEndTime}
        startTimeOptions={startTimeOptions} endTimeOptions={endTimeOptions} onStartTimeChange={onStartTimeChange} onEndTimeChange={onEndTimeChange}
        patientOptions={patientOptions} providerOptions={providerOptions} visitTypeOptions={visitTypeOptions} form={form} />
    </CalendarManagedForm>
  </CalendarModal>;
}

/** Same recovered compact content; no modal, form submission or acceptance is owned here. */
export function AppointmentModalContent({ event, isAddMode, selectedStartTime, selectedEndTime, startTimeOptions, endTimeOptions,
  onStartTimeChange, onEndTimeChange, patientOptions = defaultPatientOptions, providerOptions = defaultProviderOptions,
  visitTypeOptions = defaultVisitTypeOptions, form, footer, titleMaxLength = 160 }: AppointmentModalContentProps) {
  if (!event) return null;
  const block = form?.kind === 'block';
  return <>

        {/* Content */}
        <Stack gap="var(--calendar-size-0)" px="md" py="sm">
          {/* Title */}
          <TextInput
            variant="unstyled"
            placeholder={block ? 'Add a reason for blocking time' : 'Add patient name or title'}
            aria-label={block ? 'Block title' : 'Appointment title'}
            value={form?.value.title}
            onChange={e => form?.onChange({ title: e.currentTarget.value })}
            defaultValue={form ? undefined : isAddMode ? '' : event.title}
            data-autofocus
            maxLength={titleMaxLength}
            styles={{
              input: {
                fontWeight: 'var(--calendar-weight-medium)',
                fontSize: 'var(--calendar-font-size-md)',
                padding: 0,
                height: 'var(--calendar-size-28)',
              },
            }}
            mb="xs"
          />

          {form?.titleHelper}
          {!block && form?.appearanceControl}

          {/* Time Row */}
          <Group gap="xs" py="var(--calendar-size-4)" className="calendar-editor-time-row">
            <IconClock size="var(--calendar-size-14)" style={{ color: 'var(--calendar-color-gray-5)' }} />
            {form?.timeControls ?? <><Select
              aria-label="Start time"
              size="xs"
              variant="unstyled"
              value={selectedStartTime}
              onChange={onStartTimeChange}
              data={startTimeOptions}
              styles={{ input: { padding: 0, minHeight: 'var(--calendar-size-20)', height: 'var(--calendar-size-20)' } }}
              w="var(--calendar-size-80)"
            />
            <Text size="xs" c="dimmed">
              →
            </Text>
            <Select
              aria-label="End time"
              size="xs"
              variant="unstyled"
              value={selectedEndTime}
              onChange={onEndTimeChange}
              data={endTimeOptions}
              styles={{ input: { padding: 0, minHeight: 'var(--calendar-size-20)', height: 'var(--calendar-size-20)' } }}
              w="var(--calendar-size-80)"
            /></>}
            {form?.dateControl !== undefined ? form.dateControl : form ? <CalendarDateField value={form.value.date} onChange={date => form.onChange({ date })} /> : <Text size="xs" c="dimmed">Tue, Mar 19</Text>}
          </Group>

          {/* Recurrence */}
          <Group gap="xs" py="var(--calendar-size-4)">
            <IconRepeat size="var(--calendar-size-14)" style={{ color: 'var(--calendar-color-gray-5)' }} />
            {form?.repeatControl ? <Box style={{ flex: 1, minWidth: 0 }}>{form.repeatControl}</Box> : <Select
              aria-label="Recurrence"
              size="xs"
              variant="unstyled"
              value={form?.value.recurrence}
              onChange={value => { if (value) form?.onChange({ recurrence: value }); }}
              defaultValue={form ? undefined : 'none'}
              allowDeselect={false}
              data={recurrenceOptions}
              styles={{
                input: {
                  padding: 0,
                  minHeight: 'var(--calendar-size-20)',
                  height: 'var(--calendar-size-20)',
                  color: 'var(--calendar-muted)',
                },
              }}
              w="var(--calendar-size-140)"
            />}
          </Group>

          <Divider my="xs" />

          {/* Invitees; the original patient select remains the reference-demo fallback. */}
          {!block && <Group gap="xs" py="var(--calendar-size-4)" align={form?.attendeeControl ? 'flex-start' : 'center'}>
            <IconUser size="var(--calendar-size-14)" style={{ color: 'var(--calendar-color-gray-5)', marginTop: form?.attendeeControl ? 5 : 0, flexShrink: 0 }} />
            {form?.attendeeControl ? <Box style={{ flex: 1, minWidth: 0 }}>{form.attendeeControl}</Box> : <Select
              size="xs"
              variant="unstyled"
              placeholder="Select patient"
              aria-label="Patient"
              value={form?.value.patientId}
              onChange={value => form?.onChange({ patientId: value })}
              defaultValue={form ? undefined : isAddMode ? null : 'patient-1'}
              data={patientOptions}
              styles={{ input: { padding: 0, minHeight: 'var(--calendar-size-20)', height: 'var(--calendar-size-20)' } }}
              style={{ flex: 1 }}
              searchable
            />}
          </Group>}

          {/* Provider */}
          <Group gap="xs" py="var(--calendar-size-4)">
            <IconStethoscope size="var(--calendar-size-14)" style={{ color: 'var(--calendar-color-gray-5)' }} />
            {form?.resourceControl !== undefined ? <Box style={{ flex: 1, minWidth: 0 }}>{form.resourceControl}</Box> : <Select
              size="xs"
              variant="unstyled"
              placeholder="Assign provider"
              aria-label="Calendar / provider"
              value={form?.value.providerId}
              onChange={value => { if (value) form?.onChange({ providerId: value }); }}
              defaultValue={form ? undefined : 'dr-rhodes'}
              allowDeselect={false}
              data={providerOptions}
              styles={{ input: { padding: 0, minHeight: 'var(--calendar-size-20)', height: 'var(--calendar-size-20)' } }}
              style={{ flex: 1 }}
              searchable
            />}
          </Group>

          {!block && form?.siteOptions && <Group gap="xs" py="var(--calendar-size-4)">
            <IconMapPin size="var(--calendar-size-14)" style={{ color: 'var(--calendar-color-gray-5)' }} />
            <Select size="xs" variant="unstyled" aria-label="Office / location" placeholder="Choose office / location" value={form.value.siteId ?? null} data={form.siteOptions} allowDeselect={false} onChange={siteId => form.onChange({ siteId })} styles={{ input: { padding: 0, minHeight: 'var(--calendar-size-20)', height: 'var(--calendar-size-20)' } }} style={{ flex: 1 }} />
          </Group>}

          {/* Visit Type */}
          {!block && <Group gap="xs" py="var(--calendar-size-4)">
            <IconClipboardCheck size="var(--calendar-size-14)" style={{ color: 'var(--calendar-color-gray-5)' }} />
            {form?.appointmentTypeControl ? <Box style={{ flex: 1, minWidth: 0 }}>{form.appointmentTypeControl}</Box> : <Select
              size="xs"
              variant="unstyled"
              placeholder="Visit type"
              aria-label="Visit type"
              value={form?.value.visitType}
              onChange={value => form?.onChange({ visitType: value })}
              defaultValue={form ? undefined : isAddMode ? 'intake' : 'follow-up'}
              allowDeselect={false}
              data={visitTypeOptions}
              styles={{ input: { padding: 0, minHeight: 'var(--calendar-size-20)', height: 'var(--calendar-size-20)' } }}
              style={{ flex: 1 }}
            />}
          </Group>}

          {!block && <Divider my="xs" />}

          {/* Location */}
          {!block && <Group gap="xs" py="var(--calendar-size-4)">
            <IconMapPin size="var(--calendar-size-14)" style={{ color: 'var(--calendar-color-gray-5)' }} />
            {form?.locationControl !== undefined ? <Box style={{ flex: 1, minWidth: 0 }}>{form.locationControl}</Box> : <Select
              size="xs"
              variant="unstyled"
              aria-label="Location"
              value={form?.value.location}
              onChange={value => { if (value) form?.onChange({ location: value }); }}
              defaultValue={form ? undefined : 'telehealth'}
              allowDeselect={false}
              data={locationOptions}
              styles={{ input: { padding: 0, minHeight: 'var(--calendar-size-20)', height: 'var(--calendar-size-20)' } }}
              w="var(--calendar-size-100)"
            />}
          </Group>}

          {/* Video Link */}
          {!block && form?.telehealthControl !== undefined ? form.telehealthControl : !block && (!form || form.value.location === 'telehealth') && <Group gap="xs" py="var(--calendar-size-4)">
            <IconVideo size="var(--calendar-size-14)" style={{ color: 'var(--calendar-color-blue-5)' }} />
            <UnstyledButton onClick={form?.onPreviewTelehealth} aria-label="Preview Telehealth link"><Text size="xs" c="blue">
              Join with Telehealth
            </Text></UnstyledButton>
            <Text size="xs" c="dimmed">
              •
            </Text>
            <Text size="xs" c="dimmed">
              {form ? 'demo.local/s/preview' : 'Preview link unavailable'}
            </Text>
          </Group>}

          <Divider my="xs" />

          {/* Notes */}
          <Group gap="xs" py="var(--calendar-size-4)" align="flex-start">
            <IconNotes
              size="var(--calendar-size-14)"
              style={{ color: 'var(--calendar-color-gray-5)', marginTop: 'var(--calendar-size-2)' }}
            />
            {form?.notesControl !== undefined ? form.notesControl : <Textarea
              aria-label="Notes"
              value={form?.value.notes}
              onChange={e => form?.onChange({ notes: e.currentTarget.value })}
              maxLength={2000}
              size="xs"
              variant="unstyled"
              placeholder="Add notes..."
              autosize
              minRows={1}
              maxRows={3}
              styles={{ input: { padding: 0 } }}
              style={{ flex: 1 }}
            />}
          </Group>

          {/* Reminder */}
          {!block && <Group gap="xs" py="var(--calendar-size-4)">
            <IconBell size="var(--calendar-size-14)" style={{ color: 'var(--calendar-color-gray-5)' }} />
            {form?.reminderControl !== undefined ? <Box style={{ flex: 1, minWidth: 0 }}>{form.reminderControl}</Box> : <Select
              size="xs"
              variant="unstyled"
              aria-label="Reminder"
              value={form?.value.reminder}
              onChange={value => form?.onChange({ reminder: value })}
              defaultValue={form ? undefined : '30'}
              allowDeselect={false}
              data={reminderOptions}
              styles={{ input: { padding: 0, minHeight: 'var(--calendar-size-20)', height: 'var(--calendar-size-20)' } }}
              w="var(--calendar-size-120)"
            />}
          </Group>}

          {!block && form?.workflowControl}
          {/* Reference callers keep the original compact status control. */}
          {!isAddMode && !block && !form?.workflowControl && (
            <Group gap="xs" py="var(--calendar-size-4)">
              <Box w="var(--calendar-size-14)" />
              {form ? <Select aria-label="Status" size="xs" variant="unstyled" value={form.value.status} onChange={value => { if (value) form.onChange({ status: value }); }} allowDeselect={false} data={['confirmed', 'tentative', 'completed', 'cancelled'].map(value => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} w="var(--calendar-size-106)" styles={{ input: { padding: '0 var(--calendar-size-6)', minHeight: 'var(--calendar-size-20)', height: 'var(--calendar-size-20)', fontSize: 'var(--calendar-size-10)', fontWeight: 'var(--calendar-weight-heading)', color: 'var(--calendar-color-green-7)', background: 'var(--calendar-color-green-0)', borderRadius: 'var(--calendar-radius-sm)' } }} /> : <Badge size="xs" variant="light" color="green">
                Confirmed
              </Badge>}
              <Text size="xs" c="dimmed">
                •
              </Text>
              {form?.sendReminderControl !== undefined ? form.sendReminderControl : <Switch
                size="xs"
                checked={form?.value.sendReminder}
                onChange={checked => form?.onChange({ sendReminder: checked })}
                defaultChecked={form ? undefined : true}
                styles={{ label: { fontSize: 'var(--calendar-size-10)' } }}
                label="Send reminder"
              />}
            </Group>
          )}
          {!block && form?.workflowControl && (form.sendReminderControl !== undefined ? form.sendReminderControl : <Switch size="xs" checked={form.value.sendReminder} onChange={checked => form.onChange({ sendReminder: checked })} styles={{ label: { fontSize: 'var(--calendar-size-10)' } }} label="Send reminder" />)}
          {form?.warning && <Text size="xs" c="orange.8" mt="xs" role="status">{form.warning}</Text>}
          {form?.error && <Text size="xs" c="red" mt="xs" role="alert">{form.error}</Text>}
          {form?.notice && <Text size="xs" c="dimmed" mt="xs">{form.notice}</Text>}
        </Stack>

        {/* Footer */}
        <Group
          justify="space-between"
          px="md"
          py="sm"
          style={{ borderTop: 'var(--calendar-size-1) solid var(--calendar-color-gray-2)' }}
        >
          {footer !== undefined ? footer : <>{!isAddMode ? (
            <Button
              variant="subtle"
              color="red"
              size="xs"
              leftSection={<IconTrash size="var(--calendar-size-12)" />}
              onClick={form?.onCancelAppointment}
            >
              {block ? 'Remove Block' : 'Cancel Appt'}
            </Button>
          ) : (
            <div />
          )}
          <Group gap="xs">
            <CalendarDismiss><Button variant="default" size="xs">
              {isAddMode ? 'Cancel' : 'Close'}
            </Button></CalendarDismiss>
            <Button size="xs" type="submit" disabled={form?.submitDisabled}>
              {isAddMode ? block ? 'Block Time' : 'Create' : 'Save'}
            </Button>
          </Group></>}
        </Group>
  </>;
}
